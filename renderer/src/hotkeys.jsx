// Hotkeys — mapa de actions configurável, persistido em localStorage.
// Cada action tem um label (UI), uma descrição opcional e uma lista de chaves
// no formato "Mod+Mod+Tecla" (ex: "Ctrl+s", "Shift+ArrowLeft", "Enter", "m").
// O resolver normaliza o evento do teclado para essa string e procura a action.

const HOTKEY_STORAGE_KEY = 'comparador.hotkeys';

const HOTKEY_DEFAULTS = {
  'mark-keep':       { keys: ['m'],          label: 'Marcar como manter',          group: 'Classificação' },
  'mark-dup':        { keys: ['d'],          label: 'Marcar como duplicada',       group: 'Classificação' },
  'complete-group':  { keys: ['Enter'],      label: 'Concluir grupo',              group: 'Classificação' },
  'next-group':      { keys: ['n'],          label: 'Próximo grupo',               group: 'Navegação' },
  'prev-group':      { keys: ['p'],          label: 'Grupo anterior',              group: 'Navegação' },
  'nav-image-prev':  { keys: ['ArrowLeft'],  label: 'Imagem interna anterior',     group: 'Navegação' },
  'nav-image-next':  { keys: ['ArrowRight'], label: 'Próxima imagem interna',      group: 'Navegação' },
  'nav-card-up':     { keys: ['ArrowUp'],    label: 'Card acima no grid',          group: 'Navegação' },
  'nav-card-down':   { keys: ['ArrowDown'],  label: 'Card abaixo no grid',         group: 'Navegação' },
  'zoom':            { keys: ['z'],          label: 'Ampliar imagem ativa',        group: 'Visualização' },
  'compare':         { keys: ['c'],          label: 'Iniciar comparação',          group: 'Visualização' },
  'save-now':        { keys: ['Ctrl+s'],     label: 'Salvar agora',                group: 'Sistema' },
  'close-modal':     { keys: ['Escape'],     label: 'Fechar modal',                group: 'Sistema' },
};

// Ordem fixa pra exibição no painel (segue HOTKEY_DEFAULTS).
const HOTKEY_ACTIONS = Object.keys(HOTKEY_DEFAULTS);

// Teclas reservadas (não configuráveis): 1-9 e 0 selecionam card por número.
const RESERVED_KEYS_NOTE = '1-9 e 0 selecionam o card por número (não configurável).';

// Normaliza a tecla principal para um formato canônico.
function canonicalKey(key) {
  if (!key) return '';
  if (key === ' ') return 'Space';
  if (key.length === 1) {
    const ch = key.toLowerCase();
    return ch;
  }
  // ArrowLeft, Enter, Escape, Tab, F1..F12, etc — preservar case.
  return key;
}

// Converte um KeyboardEvent em string canônica "Ctrl+Shift+ArrowLeft", "m", "Enter", etc.
// Ctrl e Cmd (metaKey) são tratados como o mesmo modificador "Ctrl" — atalhos cross-platform.
function eventToKeyString(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(canonicalKey(e.key));
  return parts.join('+');
}

// Aceita "ctrl+S", "Ctrl+s", "CTRL+S" → "Ctrl+s"
function normalizeKeyString(s) {
  if (!s) return '';
  const parts = String(s).split('+').map(p => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  const mods = new Set();
  let main = '';
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (lower === 'ctrl' || lower === 'cmd' || lower === 'meta' || lower === 'control') mods.add('Ctrl');
    else if (lower === 'alt' || lower === 'option') mods.add('Alt');
    else if (lower === 'shift') mods.add('Shift');
    else main = canonicalKey(p);
  }
  const out = [];
  if (mods.has('Ctrl')) out.push('Ctrl');
  if (mods.has('Alt')) out.push('Alt');
  if (mods.has('Shift')) out.push('Shift');
  if (main) out.push(main);
  return out.join('+');
}

// Versão pretty pra UI: "Ctrl+s" → "Ctrl + S", "ArrowLeft" → "←", "Enter" → "Enter".
const KEY_DISPLAY = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Enter: 'Enter', Escape: 'Esc', Space: 'Space', Tab: 'Tab',
  Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End',
  PageUp: 'PgUp', PageDown: 'PgDn',
};
function prettyKeyString(s) {
  if (!s) return '—';
  const parts = String(s).split('+');
  return parts.map(p => {
    if (KEY_DISPLAY[p]) return KEY_DISPLAY[p];
    if (p.length === 1) return p.toUpperCase();
    return p;
  }).join(' + ');
}

// Resolve um evento → action. Devolve null se nenhuma action casa.
function resolveAction(e, config) {
  const ks = eventToKeyString(e);
  for (const action of HOTKEY_ACTIONS) {
    const def = config[action];
    if (!def) continue;
    if (def.keys.some(k => normalizeKeyString(k) === ks)) return action;
  }
  return null;
}

// Detecta conflitos: chaves que aparecem em mais de uma action.
function findConflicts(config) {
  const map = new Map(); // ks → [action, action, ...]
  for (const action of HOTKEY_ACTIONS) {
    const def = config[action];
    if (!def) continue;
    for (const k of (def.keys || [])) {
      const ks = normalizeKeyString(k);
      if (!ks) continue;
      if (!map.has(ks)) map.set(ks, []);
      map.get(ks).push(action);
    }
  }
  const conflicts = {};
  for (const [ks, actions] of map.entries()) {
    if (actions.length > 1) conflicts[ks] = actions;
  }
  return conflicts;
}

// Hook: carrega config do localStorage com merge dos defaults (evolui sem quebrar).
function useHotkeyConfig() {
  const [config, setConfig] = React.useState(() => {
    let stored = {};
    try {
      const raw = localStorage.getItem(HOTKEY_STORAGE_KEY);
      stored = raw ? JSON.parse(raw) : {};
    } catch { /* ignore */ }
    const merged = {};
    for (const action of HOTKEY_ACTIONS) {
      const def = HOTKEY_DEFAULTS[action];
      const userKeys = stored[action] && Array.isArray(stored[action].keys) ? stored[action].keys : null;
      merged[action] = { ...def, keys: userKeys || def.keys };
    }
    return merged;
  });

  const persist = React.useCallback((next) => {
    try {
      const slim = {};
      for (const action of HOTKEY_ACTIONS) {
        if (next[action]) slim[action] = { keys: next[action].keys };
      }
      localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(slim));
    } catch { /* ignore */ }
  }, []);

  const setActionKeys = React.useCallback((action, keys) => {
    setConfig(prev => {
      const next = { ...prev, [action]: { ...prev[action], keys: keys.map(normalizeKeyString).filter(Boolean) } };
      persist(next);
      return next;
    });
  }, [persist]);

  const resetAll = React.useCallback(() => {
    const fresh = {};
    for (const action of HOTKEY_ACTIONS) fresh[action] = { ...HOTKEY_DEFAULTS[action] };
    setConfig(fresh);
    try { localStorage.removeItem(HOTKEY_STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  const resetAction = React.useCallback((action) => {
    setActionKeys(action, HOTKEY_DEFAULTS[action].keys);
  }, [setActionKeys]);

  return { config, setActionKeys, resetAction, resetAll };
}

// ─── UI: modal de configuração ───────────────────────────────────────────────

const __HOTKEYS_STYLE = `
  .hk-modal { width: min(680px, 92vw); max-height: 86vh; display: flex; flex-direction: column; }
  .hk-body { padding: 0 16px 8px; overflow-y: auto; }
  .hk-note { font-size: 11.5px; color: var(--fg-3); padding: 8px 0 12px; border-bottom: 1px solid var(--line-1); margin-bottom: 8px; }
  .hk-group { font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
              color: var(--fg-3); padding: 14px 0 6px; }
  .hk-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center;
            gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line-1); }
  .hk-row:last-child { border-bottom: 0; }
  .hk-row.conflict .hk-keys { color: var(--dup); }
  .hk-label { font-size: 13px; color: var(--fg-1); }
  .hk-keys { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .hk-chip { font-family: 'JetBrains Mono', monospace; font-size: 11.5px;
             padding: 3px 8px; border-radius: 5px; background: var(--bg-3);
             border: 1px solid var(--line-2); color: var(--fg-1); }
  .hk-chip.capturing { background: var(--accent-glow); border-color: var(--accent); color: var(--fg-0); animation: hk-pulse 1.2s infinite; }
  @keyframes hk-pulse { 0%, 100% { box-shadow: 0 0 0 0 var(--accent-glow); } 50% { box-shadow: 0 0 0 4px transparent; } }
  .hk-act { display: flex; gap: 6px; }
  .hk-act button { padding: 4px 10px; border-radius: 6px; background: var(--bg-3);
                   border: 1px solid var(--line-2); color: var(--fg-2); font-size: 11.5px; cursor: pointer; }
  .hk-act button:hover { background: var(--bg-4); color: var(--fg-0); }
  .hk-act button.danger { color: var(--dup); }
  .hk-conflict-banner { padding: 8px 12px; margin: 6px 0 0; border-radius: 7px;
                        background: oklch(0.55 0.18 28 / 0.12); color: var(--dup);
                        font-size: 11.5px; border: 1px solid oklch(0.55 0.18 28 / 0.32); }
  .hk-footer { display: flex; justify-content: space-between; align-items: center;
               padding: 12px 16px; border-top: 1px solid var(--line-1); }
`;

function HotkeysModal({ config, onSetKeys, onResetAction, onResetAll, onClose }) {
  const [capturing, setCapturing] = React.useState(null); // action sendo capturada

  // Captura a próxima tecla pressionada e atribui à action.
  React.useEffect(() => {
    if (!capturing) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Esc cancela a captura sem alterar.
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setCapturing(null);
        return;
      }
      // Ignora capturas vazias (apenas modificadores).
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const ks = eventToKeyString(e);
      onSetKeys(capturing, [ks]);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, onSetKeys]);

  const conflicts = findConflicts(config);
  const conflictKs = new Set(Object.keys(conflicts));

  // Agrupa actions pelo campo `group` mantendo a ordem de HOTKEY_ACTIONS.
  const groups = [];
  const seenGroups = new Map();
  for (const action of HOTKEY_ACTIONS) {
    const def = config[action] || HOTKEY_DEFAULTS[action];
    const groupName = def.group || 'Geral';
    if (!seenGroups.has(groupName)) {
      seenGroups.set(groupName, groups.length);
      groups.push({ name: groupName, actions: [] });
    }
    groups[seenGroups.get(groupName)].actions.push(action);
  }

  return (
    <>
      <style>{__HOTKEYS_STYLE}</style>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal hk-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/></svg>
              Atalhos de teclado
            </div>
            <button className="btn" onClick={onClose}>Fechar</button>
          </div>
          <div className="hk-body">
            <div className="hk-note">
              Clique em <b>Editar</b> e pressione a tecla (ou combinação <span className="mono">Ctrl/Shift/Alt + …</span>) que deseja usar.
              Pressione <span className="mono">Esc</span> para cancelar a captura. {RESERVED_KEYS_NOTE}
            </div>

            {Object.keys(conflicts).length > 0 && (
              <div className="hk-conflict-banner">
                <b>Conflito:</b> {Object.entries(conflicts).map(([ks, actions]) =>
                  `${prettyKeyString(ks)} está em ${actions.map(a => config[a]?.label || a).join(', ')}`
                ).join(' · ')}
              </div>
            )}

            {groups.map(g => (
              <div key={g.name}>
                <div className="hk-group">{g.name}</div>
                {g.actions.map(action => {
                  const def = config[action];
                  const isCapturing = capturing === action;
                  const keys = def.keys || [];
                  const hasConflict = keys.some(k => conflictKs.has(normalizeKeyString(k)));
                  return (
                    <div key={action} className={`hk-row ${hasConflict ? 'conflict' : ''}`}>
                      <div className="hk-label">{def.label}</div>
                      <div className="hk-keys">
                        {isCapturing ? (
                          <span className="hk-chip capturing">Pressione uma tecla…</span>
                        ) : keys.length ? (
                          keys.map(k => <span key={k} className="hk-chip">{prettyKeyString(k)}</span>)
                        ) : (
                          <span className="hk-chip" style={{ opacity: 0.5 }}>—</span>
                        )}
                      </div>
                      <div className="hk-act">
                        <button onClick={() => setCapturing(isCapturing ? null : action)}>
                          {isCapturing ? 'Cancelar' : 'Editar'}
                        </button>
                        <button className="danger" onClick={() => onResetAction(action)} title="Restaurar padrão">↺</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="hk-footer">
            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Salvo automaticamente em <span className="mono">localStorage</span>.</span>
            <button className="btn" onClick={onResetAll}>Restaurar todos os padrões</button>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, {
  HOTKEY_DEFAULTS,
  HOTKEY_ACTIONS,
  RESERVED_KEYS_NOTE,
  eventToKeyString,
  normalizeKeyString,
  prettyKeyString,
  resolveAction,
  findConflicts,
  useHotkeyConfig,
  HotkeysModal,
});
