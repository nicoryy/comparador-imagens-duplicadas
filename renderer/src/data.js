'use strict';
// Helpers e estado em escala global compartilhado entre os componentes JSX.

const REQUIRED_COLS = [
  { key: 'imagem',     label: 'Imagem (URL ou caminho)', desc: 'Coluna que aponta para a imagem do print',     required: true  },
  { key: 'grupo',      label: 'Grupo',                    desc: 'Identificador do grupo de duplicadas',         required: true  },
  { key: 'manter',     label: 'Coluna "Manter"',          desc: 'Onde gravar a marcação de manter',             required: true  },
  { key: 'duplicada',  label: 'Coluna "Duplicada"',       desc: 'Onde gravar a marcação de duplicada',          required: true  },
  { key: 'id',         label: 'ID',                       desc: 'Mostrado no card como tooltip',                required: false },
  { key: 'circuito',   label: 'Circuito',                 desc: 'Mostrado no card como tooltip',                required: false },
  { key: 'observacao', label: 'Observação',               desc: 'Mostrada no card como tooltip',                required: false },
  { key: 'data',       label: 'Data',                     desc: 'Mostrada no card como tooltip',                required: false },
];

const RECENTS_KEY = 'comparador.recentFiles';
const SETTINGS_KEY = 'comparador.settings';

function loadRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(r => r && r.path).slice(0, 8) : [];
  } catch { return []; }
}
function pushRecent(file) {
  if (!file || !file.path) return;
  const list = loadRecents().filter(f => f.path !== file.path);
  list.unshift({
    path: file.path,
    name: file.name,
    size: file.size,
    modified: file.modified || Date.now(),
    lastUsed: Date.now(),
  });
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* ignore */ }
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch { return {}; }
}
function saveSettings(patch) {
  try {
    const cur = loadSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch { /* ignore */ }
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${u[i]}`;
}

function formatRelative(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `há ${Math.floor(diff / 3_600_000)} h`;
  const d = new Date(ts);
  return d.toLocaleDateString('pt-BR');
}

function parseDateLike(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  const s = String(v).trim();
  if (!s) return null;
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return new Date(iso);
  const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, d, mo, y, h = 0, mi = 0, se = 0] = m;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return new Date(year, Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
  }
  return null;
}

function formatDate(d) {
  const date = parseDateLike(d);
  if (!date) return d ? String(d) : '—';
  return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatTime(d) {
  const date = parseDateLike(d);
  if (!date) return '—';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Um grupo chega "concluído" da planilha quando toda imagem já tem marcação gravada.
function isGroupPreCompleted(g) {
  return !!(g && g.images && g.images.length && g.images.every(img => img.initialStatus));
}

// Pendentes primeiro, concluídos no fim. Partição estável: dentro de cada bloco a
// ordem natural por ID vinda do worker é preservada.
function orderPendingFirst(groups) {
  if (!Array.isArray(groups)) return [];
  const pending = [], done = [];
  for (const g of groups) (isGroupPreCompleted(g) ? done : pending).push(g);
  return pending.concat(done);
}

window.REQUIRED_COLS = REQUIRED_COLS;
window.loadRecents = loadRecents;
window.pushRecent = pushRecent;
window.loadSettings = loadSettings;
window.saveSettings = saveSettings;
window.formatBytes = formatBytes;
window.formatRelative = formatRelative;
window.formatDate = formatDate;
window.formatTime = formatTime;
window.parseDateLike = parseDateLike;
window.isGroupPreCompleted = isGroupPreCompleted;
window.orderPendingFirst = orderPendingFirst;
