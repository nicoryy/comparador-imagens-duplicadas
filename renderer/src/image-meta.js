'use strict';
// Extração de metadados embutidos no caminho/nome de arquivos de foto do SIP
// Satel (SINAPI) — porte de dump/censoip-metadata-extension/content.js.
// JS puro (sem JSX), no mesmo padrão de data.js: funções soltas + window.*.

// ---------------------------------------------------------------------
// Conversão UTM (SIRGAS2000 / GRS80) -> Lat/Long decimal
// Fórmulas de Snyder (padrão para inversão de Transversa de Mercator)
// ---------------------------------------------------------------------
function utmToLatLon(zone, easting, northing, isSouth) {
  const a = 6378137.0;                 // semi-eixo maior GRS80 (= SIRGAS2000)
  const f = 1 / 298.257222101;         // achatamento GRS80
  const k0 = 0.9996;
  const e = Math.sqrt(f * (2 - f));
  const e2 = e * e;
  const e2sq = e2 / (1 - e2);

  let x = easting - 500000.0;
  let y = northing;
  if (isSouth) y -= 10000000.0;

  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * Math.pow(e, 4)) / 64 - (5 * Math.pow(e, 6)) / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const j1 = (3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32;
  const j2 = (21 * Math.pow(e1, 2)) / 16 - (55 * Math.pow(e1, 4)) / 32;
  const j3 = (151 * Math.pow(e1, 3)) / 96;
  const j4 = (1097 * Math.pow(e1, 4)) / 512;

  const fp = mu + j1 * Math.sin(2 * mu) + j2 * Math.sin(4 * mu) + j3 * Math.sin(6 * mu) + j4 * Math.sin(8 * mu);

  const c1 = e2sq * Math.pow(Math.cos(fp), 2);
  const t1 = Math.pow(Math.tan(fp), 2);
  const r1 = (a * (1 - e2)) / Math.pow(1 - e2 * Math.pow(Math.sin(fp), 2), 1.5);
  const n1 = a / Math.sqrt(1 - e2 * Math.pow(Math.sin(fp), 2));
  const d = x / (n1 * k0);

  const q1 = (n1 * Math.tan(fp)) / r1;
  const q2 = Math.pow(d, 2) / 2;
  const q3 = ((5 + 3 * t1 + 10 * c1 - 4 * Math.pow(c1, 2) - 9 * e2sq) * Math.pow(d, 4)) / 24;
  const q4 = ((61 + 90 * t1 + 298 * c1 + 45 * Math.pow(t1, 2) - 3 * Math.pow(c1, 2) - 252 * e2sq) * Math.pow(d, 6)) / 720;
  const lat = fp - q1 * (q2 - q3 + q4);

  const q6 = ((1 + 2 * t1 + c1) * Math.pow(d, 3)) / 6;
  const q7 = ((5 - 2 * c1 + 28 * t1 - 3 * Math.pow(c1, 2) + 8 * e2sq + 24 * Math.pow(t1, 2)) * Math.pow(d, 5)) / 120;
  const lon = (d - q6 + q7) / Math.cos(fp);

  const zoneCentralMeridian = zone * 6 - 183;

  return {
    lat: (lat * 180) / Math.PI,
    lon: zoneCentralMeridian + (lon * 180) / Math.PI,
  };
}

// Quebra uma URL/caminho em segmentos não-vazios, tratando http(s) via URL
// (que resolve %encoding e query/hash) e caminho local (Windows ou POSIX)
// via split direto — o renderer roda em file://, não faz sentido usar new
// URL() com base relativa como a extensão faz em document.location.
function pathSegments(source) {
  const s = String(source || '').trim();
  if (!s) return [];
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return [];
    }
  }
  return s.split(/[\\/]+/).filter(Boolean);
}

// ---------------------------------------------------------------------
// Extração de metadados a partir da URL/caminho da imagem
// Formato observado:
// .../wsipsatel/<ANO>/<MES>/<USUARIO>//<DATA_UPLOAD>/<POS_ID>/<ARQUIVO>
// ---------------------------------------------------------------------
function parseImageMeta(source) {
  const meta = { source: source || null };
  if (!source) return meta;
  try {
    const parts = pathSegments(source);
    const idx = parts.indexOf('wsipsatel');

    if (idx !== -1) {
      meta.usuario = parts[idx + 3];
      // pode haver um segmento vazio (barra dupla) antes da data de upload
      let next = parts[idx + 4];
      let offset = 4;
      if (next && /^\d{8}$/.test(next) === false && parts[idx + 5] && /^\d{8}$/.test(parts[idx + 5])) {
        offset = 5;
      }
      meta.dataUpload = parts[idx + offset];
      meta.posId = parts[idx + offset + 1];
    }

    const filename = parts[parts.length - 1] || '';
    meta.arquivo = filename;

    // Coordenadas UTM embutidas no nome, ex: UTM24M_400015_9322373UTM
    const utmMatch = filename.match(/UTM(\d{1,2})[A-Z]?_(\d+)_(\d+)UTM/i);
    if (utmMatch) {
      meta.utmZone = parseInt(utmMatch[1], 10);
      meta.utmE = parseInt(utmMatch[2], 10);
      meta.utmN = parseInt(utmMatch[3], 10);
      const ll = utmToLatLon(meta.utmZone, meta.utmE, meta.utmN, true); // Brasil = hemisfério sul
      meta.lat = ll.lat;
      meta.lon = ll.lon;
    }

    // Timestamp de captura: 14 dígitos (DDMMAAAAHHMMSS) antes da extensão
    const tsMatch = filename.match(/(\d{14})\.\w+$/);
    if (tsMatch) {
      const ts = tsMatch[1];
      meta.dataCaptura = `${ts.slice(0, 2)}/${ts.slice(2, 4)}/${ts.slice(4, 8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}`;
    }

    // Nome do ponto/logradouro, ex: ..._ARNEIROZ-04-_POS_ID_...
    const pontoMatch = filename.match(/_{1,2}([A-Z0-9\-]+)_POS_ID/i);
    if (pontoMatch) meta.nomePonto = pontoMatch[1];
  } catch (e) {
    meta.erro = true;
  }
  return meta;
}

// Escolhe de onde extrair os metadados do arquivo: para imagens 'remote-page'
// (galeria HTML resolvida em runtime) só a URL final da foto ativa carrega o
// nome de arquivo real; nos demais casos, o caminho/URL direto do `img` já é
// a fonte.
function metaSourceFor(img, candidates, activeIdx) {
  if (Array.isArray(candidates) && candidates.length) {
    const c = candidates[activeIdx] || candidates[0];
    if (c && c.url) return c.url;
  }
  return img?.imagePath || img?.imageRaw || null;
}

function formatDateYYYYMMDD(v) {
  if (!v || String(v).length !== 8) return v || '—';
  const s = String(v);
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
}

function hasCoords(meta) {
  return !!meta && meta.lat !== undefined && meta.lon !== undefined;
}

function formatLatLon(meta) {
  if (!hasCoords(meta)) return '—';
  return `${meta.lat.toFixed(6)}, ${meta.lon.toFixed(6)}`;
}

function mapsUrlFor(meta) {
  if (!hasCoords(meta)) return null;
  return `https://www.google.com/maps?q=${meta.lat},${meta.lon}`;
}

// ---------------------------------------------------------------------
// Cópia para a área de transferência com fallback progressivo:
// IPC nativo do Electron (clipboard do main) -> Clipboard API do navegador
// (exige contexto seguro) -> execCommand('copy') via textarea temporário.
// ---------------------------------------------------------------------
async function copyText(text) {
  const value = String(text || '');
  try {
    if (window.electronAPI && typeof window.electronAPI.copyText === 'function') {
      await window.electronAPI.copyText(value);
      return true;
    }
  } catch { /* cai para os próximos fallbacks */ }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* cai para o fallback legado */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

window.utmToLatLon = utmToLatLon;
window.parseImageMeta = parseImageMeta;
window.metaSourceFor = metaSourceFor;
window.formatDateYYYYMMDD = formatDateYYYYMMDD;
window.hasImageCoords = hasCoords;
window.formatLatLon = formatLatLon;
window.mapsUrlFor = mapsUrlFor;
window.copyText = copyText;
