'use strict';
/**
 * Worker thread dedicated to xlsx/xlsm I/O via ExcelJS.
 * Runs off the main UI thread so heavy reads/writes never block React.
 *
 * Actions:
 *   listSheets    -> { filePath }                                 -> [{ name, rowCount, columnCount }]
 *   listColumns   -> { filePath, sheet }                          -> [{ key, label, letter, header }]
 *   loadGroups    -> { filePath, sheet, mapping }                 -> { groups, totalImages, totalRows }
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

function isCsv(filePath)  { return /\.csv$/i.test(filePath); }
function isXlsm(filePath) { return /\.xlsm$/i.test(filePath); }
function isLegacyXls(filePath) { return /\.xls$/i.test(filePath); }

async function loadWorkbook(filePath) {
  if (isLegacyXls(filePath)) {
    throw new Error('Formato .xls (Excel 97-2003) não é suportado. Converta para .xlsx ou .xlsm.');
  }
  const wb = new ExcelJS.Workbook();
  if (isCsv(filePath)) {
    await wb.csv.readFile(filePath);
  } else {
    await wb.xlsx.readFile(filePath);
  }
  return wb;
}

function getSheet(wb, sheetName) {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Folha "${sheetName}" não encontrada na planilha.`);
  return ws;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Actions

async function listSheets({ filePath }) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Arquivo não encontrado.');
  const wb = await loadWorkbook(filePath);
  return wb.worksheets.map(ws => ({
    name: ws.name,
    rowCount: ws.rowCount,
    columnCount: ws.columnCount,
  }));
}

async function listColumns({ filePath, sheet }) {
  const wb = await loadWorkbook(filePath);
  const ws = getSheet(wb, sheet);
  const headerRow = ws.getRow(1);
  const cols = [];
  const total = Math.max(ws.columnCount, headerRow.cellCount, 1);
  for (let c = 1; c <= total; c++) {
    const cell = headerRow.getCell(c);
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

async function loadGroups({ filePath, sheet, mapping }) {
  const wb = await loadWorkbook(filePath);
  const ws = getSheet(wb, sheet);
  const columns = await listColumns({ filePath, sheet });
  const accessor = buildAccessor(mapping, columns);

  if (!accessor.imagem || !accessor.grupo) {
    throw new Error('As colunas obrigatórias "Imagem" e "Grupo" precisam estar mapeadas.');
  }

  const baseDir = path.dirname(filePath);
  const groupsMap = new Map();
  let totalImages = 0;
  let totalRows = 0;
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

    const existingManter = accessor.manter
      ? cellToString(row.getCell(accessor.manter)).trim().toLowerCase()
      : '';
    const existingDup = accessor.duplicada
      ? cellToString(row.getCell(accessor.duplicada)).trim().toLowerCase()
      : '';

    let initialStatus = null;
    if (truthy(existingManter)) initialStatus = 'keep';
    else if (truthy(existingDup)) initialStatus = 'dup';

    const img = {
      id:        `r${rNum}`,
      rowNumber: rNum,
      imageRaw:  imagemRaw,
      imagePath,
      meta,
      initialStatus,
    };

    if (!groupsMap.has(grupoRaw)) groupsMap.set(grupoRaw, { id: grupoRaw, images: [] });
    groupsMap.get(grupoRaw).images.push(img);
    totalImages++;
  }

  const groups = [];
  for (const [gid, g] of groupsMap.entries()) {
    g.images.sort((a, b) => a.rowNumber - b.rowNumber);
    groups.push({
      id: gid,
      images: g.images,
      pairs: pairCount(g.images.length),
    });
  }
  groups.sort((a, b) => naturalCompare(a.id, b.id));

  return {
    groups,
    totalImages,
    totalRows,
    columns,
    accessor,
  };
}

async function saveStatuses({ filePath, sheet, mapping, statuses, statusLabels }) {
  if (!statuses || !Object.keys(statuses).length) return { written: 0 };

  // 1. Sanity checks antes de qualquer modificação.
  if (!fs.existsSync(filePath)) throw new Error('Arquivo de destino não existe.');
  assertWritable(filePath);

  // 2. Para .xlsm: capturar partes VBA do arquivo original (ExcelJS as descarta).
  const vbaParts = isXlsm(filePath) ? await extractVbaParts(filePath) : null;

  // 3. Carregar e aplicar as alterações em memória.
  const wb = await loadWorkbook(filePath);
  const ws = getSheet(wb, sheet);
  const columns = await listColumns({ filePath, sheet });
  const accessor = buildAccessor(mapping, columns);
  if (!accessor.manter || !accessor.duplicada) {
    throw new Error('Mapeamento ausente: colunas "Manter" e "Duplicada" são necessárias para gravar.');
  }

  const labels = {
    keep: (statusLabels && statusLabels.keep) || 'MANTER',
    dup:  (statusLabels && statusLabels.dup)  || 'DUPLICADA',
    none: (statusLabels && statusLabels.none) || '',
  };

  let written = 0;
  for (const [rowNumberStr, status] of Object.entries(statuses)) {
    const rowNumber = parseInt(rowNumberStr, 10);
    if (!rowNumber || rowNumber < 2) continue;
    const row = ws.getRow(rowNumber);
    if (status === 'keep') {
      row.getCell(accessor.manter).value    = labels.keep;
      row.getCell(accessor.duplicada).value = labels.none || null;
    } else if (status === 'dup') {
      row.getCell(accessor.manter).value    = labels.none || null;
      row.getCell(accessor.duplicada).value = labels.dup;
    } else {
      row.getCell(accessor.manter).value    = labels.none || null;
      row.getCell(accessor.duplicada).value = labels.none || null;
    }
    row.commit();
    written++;
  }

  // 4. Backup rotativo do estado atual antes de qualquer escrita destrutiva.
  const backupPath = await createBackup(filePath);

  // 5. Escrita atômica: tmp → fsync → rename. Nunca trunca o original.
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (isCsv(filePath)) {
      await wb.csv.writeFile(tmpPath);
    } else {
      await wb.xlsx.writeFile(tmpPath);
    }

    // 6. Reinjeta VBA no tmp recém escrito (apenas .xlsm).
    if (vbaParts) {
      await reinjectVbaParts(tmpPath, vbaParts);
    }

    // 7. Validação mínima: arquivo precisa ter conteúdo plausível.
    const tmpStat = await fsp.stat(tmpPath);
    if (tmpStat.size < MIN_VALID_BYTES) {
      throw new Error(`Arquivo temporário com tamanho suspeito (${tmpStat.size} bytes); abortando.`);
    }
    // Sanity check: tmp deve ser um zip válido (xlsx/xlsm são zips).
    if (!isCsv(filePath)) {
      await assertValidXlsxZip(tmpPath);
    }

    // 8. fsync para garantir persistência em disco antes do rename.
    await fsyncFile(tmpPath);

    // 9. Rename atômico no mesmo volume (Windows: ReplaceFileW semantics).
    await fsp.rename(tmpPath, filePath);

    return { written, backup: backupPath };
  } catch (err) {
    // Em qualquer falha: limpar o tmp e preservar o original intocado.
    try { await fsp.unlink(tmpPath); } catch (_) { /* ignore */ }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Safety helpers: atomic write, backup, fsync, VBA preservation.

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
  // Assinatura ZIP local file header: "PK\x03\x04".
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    throw new Error('Arquivo temporário não é um zip válido — abortando para preservar o original.');
  }
  // Tenta carregar via JSZip pra garantir EOCD presente.
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

  // Copia preservando bytes (sem truncar nem stream); fsync no destino.
  await fsp.copyFile(filePath, target);
  try { await fsyncFile(target); } catch (_) { /* best effort */ }

  // Rotação: manter só os N mais recentes para este arquivo.
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
// VBA preservation (.xlsm). ExcelJS descarta vbaProject.bin e a referência
// no Content_Types/rels ao reescrever. Capturamos as partes do arquivo original
// e reinjetamos no zip recém escrito, garantindo que o Excel reconheça o arquivo
// como .xlsm com macros.

const VBA_CONTENT_TYPE = 'application/vnd.ms-office.vbaProject';
const VBA_REL_TYPE = 'http://schemas.microsoft.com/office/2006/relationships/vbaProject';

async function extractVbaParts(filePath) {
  const buf = await fsp.readFile(filePath);
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (err) {
    // Se o original já está corrompido, melhor abortar antes de qualquer escrita.
    throw new Error(`Não foi possível ler o .xlsm original como zip (${err.message || err}).`);
  }

  const vbaFile = zip.file('xl/vbaProject.bin');
  if (!vbaFile) return null; // .xlsm sem macros — comporta como xlsx puro.

  const vbaBin = await vbaFile.async('nodebuffer');
  const vbaRelsFile = zip.file('xl/_rels/vbaProject.bin.rels');
  const vbaRels = vbaRelsFile ? await vbaRelsFile.async('nodebuffer') : null;

  // Captura codeName do workbookPr, se houver — sem ele o Excel pode reclamar.
  let codeName = null;
  const wbXml = zip.file('xl/workbook.xml');
  if (wbXml) {
    const txt = await wbXml.async('string');
    const m = txt.match(/<workbookPr\b[^>]*\bcodeName\s*=\s*"([^"]+)"/);
    if (m) codeName = m[1];
  }

  return { vbaBin, vbaRels, codeName };
}

async function reinjectVbaParts(tmpPath, parts) {
  if (!parts || !parts.vbaBin) return;

  const buf = await fsp.readFile(tmpPath);
  const zip = await JSZip.loadAsync(buf);

  // 1. Adiciona o binário do VBA (e .rels acessório, se existia).
  zip.file('xl/vbaProject.bin', parts.vbaBin);
  if (parts.vbaRels) {
    zip.file('xl/_rels/vbaProject.bin.rels', parts.vbaRels);
  }

  // 2. Garante a declaração em [Content_Types].xml.
  await patchContentTypes(zip);

  // 3. Garante a Relationship no workbook.xml.rels.
  await patchWorkbookRels(zip);

  // 4. Garante codeName em workbook.xml (workbookPr).
  if (parts.codeName) {
    await patchWorkbookCodeName(zip, parts.codeName);
  }

  // Regrava o tmp com tudo dentro.
  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  });
  await fsp.writeFile(tmpPath, out);
}

async function patchContentTypes(zip) {
  const file = zip.file('[Content_Types].xml');
  if (!file) throw new Error('[Content_Types].xml ausente no arquivo gerado pelo ExcelJS.');
  let xml = await file.async('string');

  // Adiciona Override para vbaProject.bin (se ainda não existir).
  if (!/PartName\s*=\s*"\/xl\/vbaProject\.bin"/.test(xml)) {
    const override = `<Override PartName="/xl/vbaProject.bin" ContentType="${VBA_CONTENT_TYPE}"/>`;
    xml = xml.replace(/<\/Types>\s*$/, `${override}</Types>`);
  }
  zip.file('[Content_Types].xml', xml);
}

async function patchWorkbookRels(zip) {
  const rels = zip.file('xl/_rels/workbook.xml.rels');
  if (!rels) throw new Error('xl/_rels/workbook.xml.rels ausente no arquivo gerado.');
  let xml = await rels.async('string');

  if (new RegExp(`Type\\s*=\\s*"${VBA_REL_TYPE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(xml)) {
    return; // já existe
  }

  // Escolhe um rId que não colida com os atuais.
  const ids = [...xml.matchAll(/Id\s*=\s*"rId(\d+)"/g)].map(m => parseInt(m[1], 10));
  const nextId = (ids.length ? Math.max(...ids) : 0) + 1;
  const rel = `<Relationship Id="rId${nextId}" Type="${VBA_REL_TYPE}" Target="vbaProject.bin"/>`;
  xml = xml.replace(/<\/Relationships>\s*$/, `${rel}</Relationships>`);
  zip.file('xl/_rels/workbook.xml.rels', xml);
}

async function patchWorkbookCodeName(zip, codeName) {
  const wb = zip.file('xl/workbook.xml');
  if (!wb) return;
  let xml = await wb.async('string');
  const safe = String(codeName).replace(/"/g, '&quot;');

  if (/<workbookPr\b[^>]*\bcodeName\s*=\s*"[^"]*"/.test(xml)) {
    xml = xml.replace(/(<workbookPr\b[^>]*\bcodeName\s*=\s*")[^"]*(")/, `$1${safe}$2`);
  } else if (/<workbookPr\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/<workbookPr\b([^>]*)\/>/, `<workbookPr$1 codeName="${safe}"/>`);
  } else if (/<workbookPr\b[^>]*>/.test(xml)) {
    xml = xml.replace(/<workbookPr\b([^>]*)>/, `<workbookPr$1 codeName="${safe}">`);
  } else {
    // Insere logo após <workbook ...>.
    xml = xml.replace(/(<workbook\b[^>]*>)/, `$1<workbookPr codeName="${safe}"/>`);
  }
  zip.file('xl/workbook.xml', xml);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

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
