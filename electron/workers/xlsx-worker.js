'use strict';
/**
 * Worker thread dedicated to xlsx/xlsm I/O.
 * Runs off the main UI thread so heavy reads/writes never block React.
 *
 * Estratégia de memória:
 *   - Leitura: ExcelJS streaming reader (não materializa o workbook inteiro
 *     em objetos JS — itera linha-a-linha).
 *   - Escrita: patching direto do XML via JSZip, sem reabrir o workbook.
 *     Mantém vbaProject.bin, estilos, fórmulas e formatação intactos porque
 *     o zip original é preservado byte-a-byte fora do worksheet alvo.
 *
 * Actions:
 *   listSheets    -> { filePath }                                 -> [{ name, rowCount, columnCount }]
 *   listColumns   -> { filePath, sheet }                          -> [{ key, label, letter, header }]
 *   loadGroups    -> { filePath, sheet, mapping }                 -> { groups, totalImages, totalRows, columns, accessor }
 *   saveStatuses  -> { filePath, sheet, mapping, statuses }       -> { written }
 */

const { parentPort } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const BACKUP_DIR_NAME = '.backup';
const BACKUP_KEEP = 5;
const MIN_VALID_BYTES = 200;

parentPort.on('message', async (msg) => {
  const { id, action, payload } = msg;
  try {
    let result;
    switch (action) {
      case 'listSheets':   result = await listSheets(payload); break;
      case 'listColumns':  result = await listColumns(payload); break;
      case 'loadGroups':   result = await loadGroups(payload); break;
      case 'saveStatuses': result = await saveStatuses(payload); break;
      default: throw new Error(`Ação desconhecida: ${action}`);
    }
    parentPort.postMessage({ id, result });
  } catch (err) {
    parentPort.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Format detection

function isCsv(filePath)  { return /\.csv$/i.test(filePath); }
function isXlsm(filePath) { return /\.xlsm$/i.test(filePath); }
function isLegacyXls(filePath) { return /\.xls$/i.test(filePath); }

// ─────────────────────────────────────────────────────────────────────────────
// Streaming reader helpers

function createStreamReader(filePath) {
  return new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
  });
}

// Importante sobre o padrão de iteração:
//   - Não use `break` para sair do `for await (const row of worksheet)` ANTES
//     do fim — o stream subjacente do SAX/zip aborta com
//     "The operation was aborted" ao tentar avançar para o próximo entry.
//   - Para pular um worksheet, basta NÃO iterar suas rows; o
//     WorkbookReader.parse() chama `entry.autodrain()` por conta própria.
//   - Para processar parcialmente, itere até o fim (no-op nas rows restantes).

function colLetter(col) {
  let letter = '';
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

function letterToCol(letter) {
  let col = 0;
  for (const ch of letter) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col;
}

function parseColRef(ref) {
  if (!ref) return null;
  const match = String(ref).match(/^([A-Z]+)\b/i);
  if (!match) return null;
  return { letter: match[1].toUpperCase(), col: letterToCol(match[1].toUpperCase()) };
}

function cellToString(cell) {
  if (cell == null) return '';
  const v = cell.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (v.text) return String(v.text);
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.result != null) return String(v.result);
    if (v.hyperlink) return String(v.hyperlink);
    if (v.formula) return String(v.formula);
    return JSON.stringify(v);
  }
  return String(v);
}

function cellToValue(cell) {
  if (cell == null) return null;
  const v = cell.value;
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (v.text) return v.text;
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.result != null) return v.result;
    if (v.hyperlink) return v.hyperlink;
    if (v.formula) return v.formula;
    return null;
  }
  return v;
}

function rowColumnCount(row) {
  const values = row.values || [];
  return Math.max(values.length - 1, row.cellCount || 0, 0);
}

function extractColumnsFromHeader(row) {
  const cols = [];
  const total = Math.max(rowColumnCount(row), 1);
  for (let c = 1; c <= total; c++) {
    const cell = row.getCell(c);
    const letter = colLetter(c);
    const header = cellToString(cell).trim();
    const label = header ? `${letter} · ${header}` : `${letter} · (sem cabeçalho)`;
    cols.push({ letter, col: c, header, label });
  }
  return cols;
}

function buildAccessor(mapping, columns) {
  const byLabel = new Map(columns.map(c => [c.label, c]));
  const accessor = {};
  for (const [key, ref] of Object.entries(mapping || {})) {
    if (!ref) { accessor[key] = null; continue; }
    const found = byLabel.get(ref) || (() => {
      const parsed = parseColRef(ref);
      if (!parsed) return null;
      return columns.find(c => c.letter === parsed.letter) || null;
    })();
    accessor[key] = found ? found.col : null;
  }
  return accessor;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV fallback (formato pequeno, raro — mantém ExcelJS de leitura/escrita).

async function loadCsvWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.csv.readFile(filePath);
  return wb;
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions

async function listSheets({ filePath }) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Arquivo não encontrado.');
  if (isLegacyXls(filePath)) {
    throw new Error('Formato .xls (Excel 97-2003) não é suportado. Converta para .xlsx ou .xlsm.');
  }
  if (isCsv(filePath)) {
    const wb = await loadCsvWorkbook(filePath);
    return wb.worksheets.map(ws => ({
      name: ws.name,
      rowCount: ws.rowCount,
      columnCount: ws.columnCount,
    }));
  }

  // Streaming: a propriedade `worksheet.dimensions` é construída
  // progressivamente conforme cada row é fechada no SAX — ou seja, só
  // termina depois de iterar todas as linhas. Então iteramos sem
  // materializar nada (apenas medindo `row.number` e a largura) para
  // produzir os contadores que o setup mostra.
  const sheets = [];
  const reader = createStreamReader(filePath);
  for await (const worksheet of reader) {
    let maxRow = 0, maxCol = 0;
    for await (const row of worksheet) {
      if (row.number > maxRow) maxRow = row.number;
      const cc = rowColumnCount(row);
      if (cc > maxCol) maxCol = cc;
    }
    sheets.push({ name: worksheet.name, rowCount: maxRow, columnCount: maxCol });
  }
  return sheets;
}

async function listColumns({ filePath, sheet }) {
  if (isCsv(filePath)) {
    const wb = await loadCsvWorkbook(filePath);
    const ws = wb.getWorksheet(sheet) || wb.worksheets[0];
    if (!ws) throw new Error(`Folha "${sheet}" não encontrada na planilha.`);
    return extractColumnsFromHeader(ws.getRow(1));
  }

  const reader = createStreamReader(filePath);
  let cols = null;
  let found = false;
  for await (const worksheet of reader) {
    if (worksheet.name !== sheet) continue; // autodrain interno cuida
    found = true;
    for await (const row of worksheet) {
      if (row.number === 1 && cols == null) {
        cols = extractColumnsFromHeader(row);
      }
      // Continuamos iterando para drenar o stream limpo (sem break).
    }
  }
  if (!found) throw new Error(`Folha "${sheet}" não encontrada na planilha.`);
  return cols || [];
}

async function loadGroups({ filePath, sheet, mapping }) {
  if (isCsv(filePath)) return loadGroupsCsv({ filePath, sheet, mapping });

  const baseDir = path.dirname(filePath);
  const groupsMap = new Map();
  let totalImages = 0;
  let totalRows = 0;
  let columns = null;
  let accessor = null;

  const reader = createStreamReader(filePath);
  let processed = false;
  for await (const worksheet of reader) {
    if (worksheet.name !== sheet) continue; // autodrain interno cuida

    for await (const row of worksheet) {
      if (row.number === 1) {
        columns = extractColumnsFromHeader(row);
        accessor = buildAccessor(mapping, columns);
        if (!accessor.imagem || !accessor.grupo) {
          throw new Error('As colunas obrigatórias "Imagem" e "Grupo" precisam estar mapeadas.');
        }
        continue;
      }
      if (!accessor) continue;
      if (!row || row.cellCount === 0) continue;

      const imagemRaw = cellToString(row.getCell(accessor.imagem)).trim();
      const grupoRaw  = cellToString(row.getCell(accessor.grupo)).trim();
      if (!imagemRaw || !grupoRaw) continue;

      totalRows++;
      const imagePath = resolveImagePath(imagemRaw, baseDir);

      const meta = {
        ID:         accessor.id         ? cellToString(row.getCell(accessor.id)).trim()         : '',
        CIRCUITO:   accessor.circuito   ? cellToString(row.getCell(accessor.circuito)).trim()   : '',
        OBSERVACAO: accessor.observacao ? cellToString(row.getCell(accessor.observacao)).trim() : '',
        DATA:       accessor.data       ? cellToValue(row.getCell(accessor.data))               : null,
      };

      const existingManter = accessor.manter
        ? cellToString(row.getCell(accessor.manter)).trim().toLowerCase()
        : '';
      const existingDup = accessor.duplicada
        ? cellToString(row.getCell(accessor.duplicada)).trim().toLowerCase()
        : '';

      let initialStatus = null;
      if (truthy(existingManter)) initialStatus = 'keep';
      else if (truthy(existingDup)) initialStatus = 'dup';

      const rNum = row.number;
      const img = {
        id:        `r${rNum}`,
        rowNumber: rNum,
        imageRaw:  imagemRaw,
        imagePath,
        meta,
        initialStatus,
      };

      let grp = groupsMap.get(grupoRaw);
      if (!grp) { grp = { id: grupoRaw, images: [] }; groupsMap.set(grupoRaw, grp); }
      grp.images.push(img);
      totalImages++;
    }
    processed = true;
    // Não usamos `break` aqui — o for-await externo continua até o final
    // do workbook naturalmente (workbooks raramente têm muitas folhas
    // depois da alvo, e o autodrain interno descarta o restante).
  }

  if (!processed) throw new Error(`Folha "${sheet}" não encontrada na planilha.`);
  if (!columns) columns = [];

  const groups = [];
  for (const g of groupsMap.values()) {
    g.images.sort((a, b) => a.rowNumber - b.rowNumber);
    groups.push({ id: g.id, images: g.images, pairs: pairCount(g.images.length) });
  }
  groups.sort((a, b) => naturalCompare(a.id, b.id));

  return { groups, totalImages, totalRows, columns, accessor };
}

async function loadGroupsCsv({ filePath, sheet, mapping }) {
  const wb = await loadCsvWorkbook(filePath);
  const ws = wb.getWorksheet(sheet) || wb.worksheets[0];
  if (!ws) throw new Error(`Folha "${sheet}" não encontrada.`);
  const columns = extractColumnsFromHeader(ws.getRow(1));
  const accessor = buildAccessor(mapping, columns);
  if (!accessor.imagem || !accessor.grupo) {
    throw new Error('As colunas obrigatórias "Imagem" e "Grupo" precisam estar mapeadas.');
  }
  const baseDir = path.dirname(filePath);
  const groupsMap = new Map();
  let totalImages = 0, totalRows = 0;
  const lastRow = ws.actualRowCount || ws.rowCount || 1;
  for (let rNum = 2; rNum <= lastRow; rNum++) {
    const row = ws.getRow(rNum);
    if (!row || row.cellCount === 0) continue;
    const imagemRaw = cellToString(row.getCell(accessor.imagem)).trim();
    const grupoRaw  = cellToString(row.getCell(accessor.grupo)).trim();
    if (!imagemRaw || !grupoRaw) continue;
    totalRows++;
    const imagePath = resolveImagePath(imagemRaw, baseDir);
    const meta = {
      ID:         accessor.id         ? cellToString(row.getCell(accessor.id)).trim()         : '',
      CIRCUITO:   accessor.circuito   ? cellToString(row.getCell(accessor.circuito)).trim()   : '',
      OBSERVACAO: accessor.observacao ? cellToString(row.getCell(accessor.observacao)).trim() : '',
      DATA:       accessor.data       ? cellToValue(row.getCell(accessor.data))               : null,
    };
    const existingManter = accessor.manter ? cellToString(row.getCell(accessor.manter)).trim().toLowerCase() : '';
    const existingDup = accessor.duplicada ? cellToString(row.getCell(accessor.duplicada)).trim().toLowerCase() : '';
    let initialStatus = null;
    if (truthy(existingManter)) initialStatus = 'keep';
    else if (truthy(existingDup)) initialStatus = 'dup';
    const img = { id: `r${rNum}`, rowNumber: rNum, imageRaw: imagemRaw, imagePath, meta, initialStatus };
    let grp = groupsMap.get(grupoRaw);
    if (!grp) { grp = { id: grupoRaw, images: [] }; groupsMap.set(grupoRaw, grp); }
    grp.images.push(img);
    totalImages++;
  }
  const groups = [];
  for (const g of groupsMap.values()) {
    g.images.sort((a, b) => a.rowNumber - b.rowNumber);
    groups.push({ id: g.id, images: g.images, pairs: pairCount(g.images.length) });
  }
  groups.sort((a, b) => naturalCompare(a.id, b.id));
  return { groups, totalImages, totalRows, columns, accessor };
}

// ─────────────────────────────────────────────────────────────────────────────
// saveStatuses: patch direto no XML do worksheet, sem reabrir o workbook.
//
// Por que evitar o caminho via ExcelJS write:
//   - Loads e re-serializa o workbook inteiro (consome RAM = 5-20× tamanho do arquivo).
//   - Reescreve todos os XMLs internos, mesmo os não modificados.
//   - Descarta vbaProject.bin (exige reinjeção pós-write, mais um ciclo de I/O).
//
// Aqui só decompactamos o sheet alvo, aplicamos regex sobre os <row/> tocados
// e regravamos o zip. O resto do arquivo (estilos, VBA, outras sheets) sai
// byte-idêntico do zip original.

async function saveStatuses({ filePath, sheet, mapping, statuses, statusLabels }) {
  if (!statuses || !Object.keys(statuses).length) return { written: 0 };
  if (!fs.existsSync(filePath)) throw new Error('Arquivo de destino não existe.');
  assertWritable(filePath);

  if (isCsv(filePath)) {
    return saveStatusesCsv({ filePath, sheet, mapping, statuses, statusLabels });
  }

  const manterRef = parseColRef(mapping?.manter || '');
  const dupRef = parseColRef(mapping?.duplicada || '');
  if (!manterRef || !dupRef) {
    throw new Error('Mapeamento ausente: colunas "Manter" e "Duplicada" são necessárias para gravar.');
  }

  const labels = {
    keep: (statusLabels && statusLabels.keep) || 'MANTER',
    dup:  (statusLabels && statusLabels.dup)  || 'DUPLICADA',
  };

  // Carrega o zip original em memória uma única vez.
  const origBuf = await fsp.readFile(filePath);
  let zip;
  try {
    zip = await JSZip.loadAsync(origBuf);
  } catch (err) {
    throw new Error(`Não foi possível ler o arquivo como zip (${err.message || err}).`);
  }

  // Resolve o caminho interno do worksheet alvo via workbook.xml + rels.
  const sheetPath = await resolveSheetPath(zip, sheet);
  if (!sheetPath) throw new Error(`Folha "${sheet}" não encontrada na planilha.`);
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error(`Worksheet "${sheetPath}" ausente do zip.`);
  let sheetXml = await sheetFile.async('string');

  // Aplica as alterações no XML.
  let written = 0;
  for (const [rowNumberStr, status] of Object.entries(statuses)) {
    const rowNumber = parseInt(rowNumberStr, 10);
    if (!rowNumber || rowNumber < 2) continue;

    const manterVal = status === 'keep' ? labels.keep : '';
    const dupVal    = status === 'dup'  ? labels.dup  : '';

    sheetXml = setCellValue(sheetXml, rowNumber, manterRef.letter, manterVal);
    sheetXml = setCellValue(sheetXml, rowNumber, dupRef.letter, dupVal);
    written++;
  }

  zip.file(sheetPath, sheetXml);

  // Gera o novo .xlsx/.xlsm. O mimeType correto é importante pro Excel
  // detectar macros (.xlsm) sem precisar de manifesto adicional.
  const mimeType = isXlsm(filePath)
    ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType,
  });

  // Backup + escrita atômica.
  const backupPath = await createBackup(filePath);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fsp.writeFile(tmpPath, out);
    const tmpStat = await fsp.stat(tmpPath);
    if (tmpStat.size < MIN_VALID_BYTES) {
      throw new Error(`Arquivo temporário com tamanho suspeito (${tmpStat.size} bytes); abortando.`);
    }
    await assertValidXlsxZip(tmpPath);
    await fsyncFile(tmpPath);
    await fsp.rename(tmpPath, filePath);
    return { written, backup: backupPath };
  } catch (err) {
    try { await fsp.unlink(tmpPath); } catch (_) { /* ignore */ }
    throw err;
  }
}

async function saveStatusesCsv({ filePath, sheet, mapping, statuses, statusLabels }) {
  // CSV é pequeno, segue via ExcelJS (mesmo padrão de antes).
  const wb = await loadCsvWorkbook(filePath);
  const ws = wb.getWorksheet(sheet) || wb.worksheets[0];
  if (!ws) throw new Error(`Folha "${sheet}" não encontrada.`);
  const columns = extractColumnsFromHeader(ws.getRow(1));
  const accessor = buildAccessor(mapping, columns);
  if (!accessor.manter || !accessor.duplicada) {
    throw new Error('Mapeamento ausente: colunas "Manter" e "Duplicada" são necessárias para gravar.');
  }
  const labels = {
    keep: (statusLabels && statusLabels.keep) || 'MANTER',
    dup:  (statusLabels && statusLabels.dup)  || 'DUPLICADA',
    none: '',
  };
  let written = 0;
  for (const [rowNumberStr, status] of Object.entries(statuses)) {
    const rowNumber = parseInt(rowNumberStr, 10);
    if (!rowNumber || rowNumber < 2) continue;
    const row = ws.getRow(rowNumber);
    if (status === 'keep') {
      row.getCell(accessor.manter).value    = labels.keep;
      row.getCell(accessor.duplicada).value = labels.none;
    } else if (status === 'dup') {
      row.getCell(accessor.manter).value    = labels.none;
      row.getCell(accessor.duplicada).value = labels.dup;
    } else {
      row.getCell(accessor.manter).value    = labels.none;
      row.getCell(accessor.duplicada).value = labels.none;
    }
    row.commit();
    written++;
  }

  const backupPath = await createBackup(filePath);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await wb.csv.writeFile(tmpPath);
    const tmpStat = await fsp.stat(tmpPath);
    if (tmpStat.size < 1) throw new Error('CSV temporário vazio; abortando.');
    await fsyncFile(tmpPath);
    await fsp.rename(tmpPath, filePath);
    return { written, backup: backupPath };
  } catch (err) {
    try { await fsp.unlink(tmpPath); } catch (_) { /* ignore */ }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// XML helpers — usados pelo saveStatuses.

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Ordena letras de coluna por número (A < B < ... < Z < AA < AB ...).
function compareCols(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function makeInlineCell(ref, value, extraAttrs) {
  const attrs = extraAttrs ? ` ${extraAttrs.trim()}` : '';
  return `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function makeEmptyCell(ref, extraAttrs) {
  const attrs = extraAttrs ? ` ${extraAttrs.trim()}` : '';
  return `<c r="${ref}"${attrs}/>`;
}

// Preserva s="N" (estilo) se a célula original já tinha. Os outros atributos
// (t="...", outros) são substituídos porque mudamos o tipo do conteúdo.
function preservedStyle(cellAttrs) {
  if (!cellAttrs) return '';
  const m = cellAttrs.match(/\bs\s*=\s*"\d+"/);
  return m ? m[0] : '';
}

// Insere um <c r="..."/> dentro do conteúdo de um <row>, mantendo a ordem
// crescente por letra de coluna (Excel exige isso).
function insertCellInOrder(rowContent, cellRef, newCell) {
  const cellCol = cellRef.match(/^([A-Z]+)/)[1];
  const cellRe = /<c\b[^>]*\br\s*=\s*"([A-Z]+)\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g;
  let insertAt = -1;
  let m;
  while ((m = cellRe.exec(rowContent)) !== null) {
    if (compareCols(m[1], cellCol) > 0) {
      insertAt = m.index;
      break;
    }
  }
  if (insertAt === -1) return rowContent + newCell;
  return rowContent.slice(0, insertAt) + newCell + rowContent.slice(insertAt);
}

// Substitui/insere o valor de uma célula no XML do worksheet.
// - value !== '' → grava como inlineStr (preserva style se existia).
// - value === '' → esvazia a célula (mantém referência + style p/ formatação).
//                  Se a célula nem existia, no-op.
function setCellValue(xml, rowNumber, colLetter, value) {
  const cellRef = `${colLetter}${rowNumber}`;
  const hasValue = value !== '' && value != null;

  // Localiza o <row r="N"> alvo.
  const rowAutoRe = new RegExp(`<row\\b[^>]*\\br\\s*=\\s*"${rowNumber}"[^>]*/>`);
  const rowAutoMatch = xml.match(rowAutoRe);
  if (rowAutoMatch) {
    if (!hasValue) return xml; // row vazia + clear → nada a fazer
    const opener = rowAutoMatch[0].slice(0, -2); // remove "/>"
    const replaced = `${opener}>${makeInlineCell(cellRef, value, '')}</row>`;
    return xml.replace(rowAutoRe, replaced);
  }

  const rowFullRe = new RegExp(`(<row\\b[^>]*\\br\\s*=\\s*"${rowNumber}"[^>]*>)([\\s\\S]*?)(</row>)`);
  const fullMatch = xml.match(rowFullRe);
  if (!fullMatch) {
    // Row simplesmente não existe no XML. Como saveStatuses só edita linhas
    // que já vieram do load, esse caminho não deveria ocorrer; mas se ocorrer
    // e queremos limpar, é no-op.
    if (!hasValue) return xml;
    // Defensivamente: não injeta row nova fora de ordem — perderíamos a garantia
    // de ordenação que o Excel exige. Aborta silenciosamente.
    return xml;
  }

  const rowOpen = fullMatch[1];
  let rowContent = fullMatch[2];
  const rowClose = fullMatch[3];

  // Localiza a célula dentro da row.
  const cellAutoRe = new RegExp(`<c\\b([^>]*\\br\\s*=\\s*"${cellRef}"[^>]*)/>`);
  const cellFullRe = new RegExp(`<c\\b([^>]*\\br\\s*=\\s*"${cellRef}"[^>]*)>[\\s\\S]*?</c>`);

  let cellAttrs = null;
  let kind = null; // 'auto' | 'full' | null
  let cellAutoMatch = rowContent.match(cellAutoRe);
  if (cellAutoMatch) { cellAttrs = cellAutoMatch[1]; kind = 'auto'; }
  else {
    const cellFullMatch = rowContent.match(cellFullRe);
    if (cellFullMatch) { cellAttrs = cellFullMatch[1]; kind = 'full'; }
  }

  if (kind) {
    const sAttr = preservedStyle(cellAttrs);
    if (hasValue) {
      const newCell = makeInlineCell(cellRef, value, sAttr);
      const re = kind === 'auto' ? cellAutoRe : cellFullRe;
      rowContent = rowContent.replace(re, newCell);
    } else {
      const empty = makeEmptyCell(cellRef, sAttr);
      const re = kind === 'auto' ? cellAutoRe : cellFullRe;
      rowContent = rowContent.replace(re, empty);
    }
  } else {
    if (!hasValue) return xml; // limpar célula inexistente: no-op
    rowContent = insertCellInOrder(rowContent, cellRef, makeInlineCell(cellRef, value, ''));
  }

  return xml.replace(rowFullRe, `${rowOpen}${rowContent}${rowClose}`);
}

// Resolve o nome da folha → caminho interno (ex.: xl/worksheets/sheet3.xml).
async function resolveSheetPath(zip, sheetName) {
  const wbFile = zip.file('xl/workbook.xml');
  const relsFile = zip.file('xl/_rels/workbook.xml.rels');
  if (!wbFile || !relsFile) return null;
  const wbXml = await wbFile.async('string');
  const relsXml = await relsFile.async('string');

  const sheetRe = /<sheet\b[^>]*\bname\s*=\s*"([^"]+)"[^>]*?\b(?:r:id|r:Id|relationships:id)\s*=\s*"([^"]+)"/g;
  let m, rId = null;
  while ((m = sheetRe.exec(wbXml)) !== null) {
    if (decodeXmlEntities(m[1]) === sheetName) { rId = m[2]; break; }
  }
  if (!rId) return null;

  const relRe = new RegExp(`<Relationship\\b[^>]*\\bId\\s*=\\s*"${rId}"[^>]*\\bTarget\\s*=\\s*"([^"]+)"`);
  const rm = relsXml.match(relRe);
  if (!rm) return null;

  let target = decodeXmlEntities(rm[1]);
  // Targets em workbook.xml.rels são relativos a /xl/.
  if (target.startsWith('/')) return target.slice(1);
  return `xl/${target}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Safety helpers: writable check, fsync, valid-zip check, backup.

function assertWritable(filePath) {
  // No Windows, Excel mantém o arquivo aberto com sharing exclusivo de escrita.
  // Abrir com 'r+' falha cedo (EBUSY/EPERM) sem truncar nada.
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r+');
  } catch (err) {
    const code = err && err.code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new Error(
        'Arquivo está em uso por outro programa (provavelmente o Excel está com a planilha aberta). ' +
        'Feche o arquivo no Excel e tente salvar novamente.'
      );
    }
    throw err;
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch (_) { /* ignore */ } }
  }
}

async function fsyncFile(filePath) {
  const fh = await fsp.open(filePath, 'r+');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

async function assertValidXlsxZip(filePath) {
  const buf = await fsp.readFile(filePath);
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    throw new Error('Arquivo temporário não é um zip válido — abortando para preservar o original.');
  }
  try {
    await JSZip.loadAsync(buf);
  } catch (err) {
    throw new Error(`Arquivo temporário corrompido (${err.message || err}); abortando.`);
  }
}

async function createBackup(filePath) {
  const dir = path.join(path.dirname(filePath), BACKUP_DIR_NAME);
  await fsp.mkdir(dir, { recursive: true });
  const base = path.basename(filePath);
  const ts = formatTimestamp(new Date());
  const target = path.join(dir, `${base}.${ts}.bak`);

  await fsp.copyFile(filePath, target);
  try { await fsyncFile(target); } catch (_) { /* best effort */ }

  try {
    const entries = await fsp.readdir(dir);
    const mine = entries
      .filter(name => name.startsWith(`${base}.`) && name.endsWith('.bak'))
      .map(name => ({ name, full: path.join(dir, name) }));
    const stats = await Promise.all(mine.map(async e => ({ ...e, mtime: (await fsp.stat(e.full)).mtimeMs })));
    stats.sort((a, b) => b.mtime - a.mtime);
    for (const old of stats.slice(BACKUP_KEEP)) {
      try { await fsp.unlink(old.full); } catch (_) { /* ignore */ }
    }
  } catch (_) { /* rotação é best-effort, não deve falhar o save */ }

  return target;
}

function formatTimestamp(d) {
  const pad = n => String(n).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${ms}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic helpers

function pairCount(n) {
  if (n < 2) return 0;
  return Math.min(99, Math.floor((n * (n - 1)) / 2));
}

function truthy(v) {
  if (!v) return false;
  const s = String(v).toLowerCase().trim();
  return s === '1' || s === 'x' || s === 'true' || s === 'sim' || s === 'manter' || s === 'duplicada' || s === 'keep' || s === 'dup' || s === 'duplicate';
}

function naturalCompare(a, b) {
  const ax = [], bx = [];
  String(a).replace(/(\d+)|(\D+)/g, (_, n, s) => { ax.push([n || Infinity, s || '']); });
  String(b).replace(/(\d+)|(\D+)/g, (_, n, s) => { bx.push([n || Infinity, s || '']); });
  while (ax.length && bx.length) {
    const an = ax.shift(), bn = bx.shift();
    const nn = (an[0] === Infinity ? Infinity : parseInt(an[0], 10)) -
               (bn[0] === Infinity ? Infinity : parseInt(bn[0], 10));
    if (nn) return nn;
    const ss = an[1].localeCompare(bn[1]);
    if (ss) return ss;
  }
  return ax.length - bx.length;
}

function resolveImagePath(raw, baseDir) {
  if (!raw) return null;
  let p = raw.trim();
  if (/^https?:\/\//i.test(p)) return p;
  if (/^file:\/\//i.test(p)) return p.replace(/^file:\/\//i, '');
  if (path.isAbsolute(p)) return p;
  return path.resolve(baseDir, p);
}
