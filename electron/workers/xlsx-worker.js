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
const ExcelJS = require('exceljs');

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

  if (isCsv(filePath)) {
    await wb.csv.writeFile(filePath);
  } else {
    await wb.xlsx.writeFile(filePath);
  }
  return { written };
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
