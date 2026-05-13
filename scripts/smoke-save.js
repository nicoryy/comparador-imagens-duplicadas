'use strict';
/**
 * Smoke test: exercita o pipeline saveStatuses end-to-end.
 *
 *   1. Gera um .xlsx sintético + um .xlsm com macro fake (vbaProject.bin).
 *   2. Roda saveStatuses para cada um.
 *   3. Verifica:
 *      - arquivo final é um zip válido
 *      - dados (linha 2, coluna Manter/Duplicada) foram gravados
 *      - .xlsm preservou vbaProject.bin, Content_Types e Relationship
 *      - pasta .backup/ tem o snapshot do antes
 *      - .tmp não ficou para trás
 *
 * Não depende do Electron; carrega o worker como módulo Node.
 */
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { Worker } = require('node:worker_threads');

const WORKER_PATH = path.join(__dirname, '..', 'electron', 'workers', 'xlsx-worker.js');

function runJob(action, payload) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_PATH);
    w.once('message', msg => { w.terminate(); msg.error ? reject(new Error(msg.error)) : resolve(msg.result); });
    w.once('error', err => { w.terminate(); reject(err); });
    w.postMessage({ id: 1, action, payload });
  });
}

async function makeBaseXlsx(filePath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dados');
  ws.addRow(['Grupo', 'Imagem', 'Manter', 'Duplicada']);
  ws.addRow(['G1', 'a.jpg', '', '']);
  ws.addRow(['G1', 'b.jpg', '', '']);
  ws.addRow(['G2', 'c.jpg', '', '']);
  await wb.xlsx.writeFile(filePath);
}

async function toXlsmWithMacro(srcXlsx, dstXlsm) {
  // Carrega o xlsx, adiciona vbaProject.bin fake + Content_Types + relationship.
  const buf = await fsp.readFile(srcXlsx);
  const zip = await JSZip.loadAsync(buf);
  const fakeVba = Buffer.from('FAKEVBA-MACRO-CONTENT-' + 'A'.repeat(2048));
  zip.file('xl/vbaProject.bin', fakeVba);

  // Content_Types: adiciona Override
  let ct = await zip.file('[Content_Types].xml').async('string');
  if (!ct.includes('vbaProject.bin')) {
    ct = ct.replace(/<\/Types>\s*$/, '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');
    zip.file('[Content_Types].xml', ct);
  }
  // workbook.xml.rels: adiciona Relationship
  let rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  if (!rels.includes('vbaProject')) {
    const ids = [...rels.matchAll(/Id\s*=\s*"rId(\d+)"/g)].map(m => parseInt(m[1], 10));
    const next = (ids.length ? Math.max(...ids) : 0) + 1;
    rels = rels.replace(/<\/Relationships>\s*$/, `<Relationship Id="rId${next}" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>`);
    zip.file('xl/_rels/workbook.xml.rels', rels);
  }
  // workbook.xml: adiciona codeName
  let wbXml = await zip.file('xl/workbook.xml').async('string');
  if (!/codeName=/.test(wbXml)) {
    if (/<workbookPr\b[^>]*\/>/.test(wbXml)) {
      wbXml = wbXml.replace(/<workbookPr\b([^>]*)\/>/, '<workbookPr$1 codeName="ThisWorkbook"/>');
    } else if (/<workbookPr\b[^>]*>/.test(wbXml)) {
      wbXml = wbXml.replace(/<workbookPr\b([^>]*)>/, '<workbookPr$1 codeName="ThisWorkbook">');
    } else {
      wbXml = wbXml.replace(/(<workbook\b[^>]*>)/, '$1<workbookPr codeName="ThisWorkbook"/>');
    }
    zip.file('xl/workbook.xml', wbXml);
  }
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await fsp.writeFile(dstXlsm, out);
}

async function inspectZip(file) {
  const buf = await fsp.readFile(file);
  const zip = await JSZip.loadAsync(buf);
  return {
    size: buf.length,
    hasVba: !!zip.file('xl/vbaProject.bin'),
    contentTypes: await zip.file('[Content_Types].xml').async('string'),
    wbRels: await zip.file('xl/_rels/workbook.xml.rels').async('string'),
    workbook: await zip.file('xl/workbook.xml').async('string'),
  };
}

async function checkValues(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('Dados');
  return {
    r2_C: ws.getCell('C2').value,
    r2_D: ws.getCell('D2').value,
    r3_D: ws.getCell('D3').value,
  };
}

async function main() {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cidup-smoke-'));
  console.log('tmpDir =', tmpDir);
  const xlsx = path.join(tmpDir, 'base.xlsx');
  const xlsm = path.join(tmpDir, 'macro.xlsm');
  await makeBaseXlsx(xlsx);
  await toXlsmWithMacro(xlsx, xlsm);

  const mapping = {
    grupo: 'A · Grupo',
    imagem: 'B · Imagem',
    manter: 'C · Manter',
    duplicada: 'D · Duplicada',
  };
  const statuses = { 2: 'keep', 3: 'dup' };

  console.log('\n--- TESTE 1: .xlsx ---');
  const r1 = await runJob('saveStatuses', { filePath: xlsx, sheet: 'Dados', mapping, statuses });
  console.log('result:', r1);
  const vals1 = await checkValues(xlsx);
  console.log('values:', vals1);
  if (vals1.r2_C !== 'MANTER' || vals1.r3_D !== 'DUPLICADA') throw new Error('Falha: gravação .xlsx incorreta');
  // .tmp não ficou
  const leftover1 = (await fsp.readdir(tmpDir)).filter(n => n.includes('.tmp-'));
  if (leftover1.length) throw new Error('Falha: arquivo .tmp não removido: ' + leftover1.join(','));
  // backup criado
  const backups1 = await fsp.readdir(path.join(tmpDir, '.backup'));
  console.log('backups:', backups1);
  if (!backups1.length) throw new Error('Falha: backup não criado');

  console.log('\n--- TESTE 2: .xlsm com macro ---');
  const r2 = await runJob('saveStatuses', { filePath: xlsm, sheet: 'Dados', mapping, statuses });
  console.log('result:', r2);
  const insp = await inspectZip(xlsm);
  console.log('zip size =', insp.size);
  console.log('hasVba   =', insp.hasVba);
  if (!insp.hasVba) throw new Error('Falha CRÍTICA: vbaProject.bin foi perdido no .xlsm');
  if (!insp.contentTypes.includes('vbaProject.bin')) throw new Error('Falha: Content_Types sem vbaProject');
  if (!insp.wbRels.includes('vbaProject')) throw new Error('Falha: workbook.xml.rels sem vbaProject');
  if (!insp.workbook.includes('codeName=')) throw new Error('Falha: workbook.xml sem codeName');
  const vals2 = await checkValues(xlsm);
  console.log('values:', vals2);
  if (vals2.r2_C !== 'MANTER' || vals2.r3_D !== 'DUPLICADA') throw new Error('Falha: gravação .xlsm incorreta');

  console.log('\n--- TESTE 3: arquivo inexistente ---');
  try {
    await runJob('saveStatuses', { filePath: path.join(tmpDir, 'nope.xlsx'), sheet: 'Dados', mapping, statuses });
    throw new Error('Falha: deveria ter rejeitado arquivo inexistente');
  } catch (e) {
    if (!/não existe/i.test(e.message)) throw new Error('Falha: erro inesperado: ' + e.message);
    console.log('OK rejeitou:', e.message);
  }

  console.log('\n--- TESTE 4: backup rotativo (> 5) ---');
  for (let i = 0; i < 7; i++) {
    await runJob('saveStatuses', { filePath: xlsx, sheet: 'Dados', mapping, statuses: { 2: i % 2 ? 'dup' : 'keep' } });
    await new Promise(r => setTimeout(r, 50)); // separar timestamps
  }
  const backups2 = (await fsp.readdir(path.join(tmpDir, '.backup'))).filter(n => n.startsWith('base.xlsx.'));
  console.log('backups após 8 saves:', backups2.length, '(deveria ser <= 5)');
  if (backups2.length > 5) throw new Error('Falha: rotação de backups não funcionou');

  console.log('\n✔ Todos os testes passaram.');
  // cleanup
  try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
}

main().catch(e => { console.error('FALHA:', e); process.exit(1); });
