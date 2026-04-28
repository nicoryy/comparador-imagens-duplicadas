// Painel de tweaks (preferências em tempo real). Versão simplificada para Electron — usa localStorage,
// sem o protocolo postMessage do design original (não há host iframe).

const __TWEAKS_STYLE = `
  .twk-fab {
    position: fixed; right: 16px; bottom: 16px; z-index: 90;
    width: 40px; height: 40px; border-radius: 50%;
    background: var(--bg-3); border: 1px solid var(--line-2); color: var(--fg-1);
    display: grid; place-items: center; cursor: pointer;
    box-shadow: 0 8px 24px oklch(0 0 0 / 0.45), 0 0 0 1px oklch(1 0 0 / 0.04) inset;
    transition: all .15s;
  }
  .twk-fab:hover { background: var(--bg-4); color: var(--fg-0); transform: scale(1.04); }
  .twk-panel {
    position: fixed; right: 16px; bottom: 64px; z-index: 91;
    width: 280px; max-height: calc(100vh - 80px);
    background: var(--bg-1); color: var(--fg-1);
    border: 1px solid var(--line-2); border-radius: 12px;
    box-shadow: 0 20px 60px oklch(0 0 0 / 0.5);
    overflow: hidden; display: flex; flex-direction: column;
    font: 12px/1.4 'Inter', system-ui, sans-serif;
  }
  .twk-hd { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--line-1); }
  .twk-hd b { font-size: 12.5px; font-weight: 600; color: var(--fg-0); letter-spacing: -0.005em; }
  .twk-x { width: 22px; height: 22px; border-radius: 5px; color: var(--fg-3); display: grid; place-items: center; }
  .twk-x:hover { background: var(--bg-3); color: var(--fg-0); }
  .twk-body { padding: 10px 12px 14px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
  .twk-row { display: flex; flex-direction: column; gap: 5px; }
  .twk-row-h { flex-direction: row; align-items: center; justify-content: space-between; gap: 10px; }
  .twk-lbl { display: flex; justify-content: space-between; align-items: baseline; color: var(--fg-2); font-size: 11.5px; }
  .twk-lbl > span:first-child { font-weight: 500; }
  .twk-val { color: var(--fg-3); font-variant-numeric: tabular-nums; font-family: 'JetBrains Mono', monospace; font-size: 11px; }
  .twk-sect { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-3); padding: 6px 0 0; }
  .twk-sect:first-child { padding-top: 0; }

  .twk-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; margin: 6px 0; border-radius: 999px; background: var(--bg-3); outline: none; }
  .twk-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--accent); border: 1px solid var(--accent-soft); cursor: pointer; box-shadow: 0 0 8px var(--accent-glow); }

  .twk-seg { display: flex; padding: 2px; border-radius: 8px; background: var(--bg-3); user-select: none; }
  .twk-seg button { flex: 1; padding: 5px 8px; font-size: 11.5px; border-radius: 6px; color: var(--fg-2); }
  .twk-seg button.on { background: var(--bg-4); color: var(--fg-0); box-shadow: 0 1px 0 oklch(1 0 0 / 0.05) inset; }

  .twk-toggle { position: relative; width: 32px; height: 18px; border-radius: 999px; background: var(--bg-3); cursor: pointer; padding: 0; border: 1px solid var(--line-2); }
  .twk-toggle[data-on="1"] { background: var(--keep); border-color: var(--keep-soft); }
  .twk-toggle i { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--fg-0); transition: transform .15s; }
  .twk-toggle[data-on="1"] i { transform: translateX(14px); }

  .twk-btn { padding: 7px 10px; border-radius: 7px; background: var(--bg-3); border: 1px solid var(--line-2); color: var(--fg-1); font-size: 11.5px; cursor: pointer; transition: all .12s; }
  .twk-btn:hover { background: var(--bg-4); color: var(--fg-0); }
  .twk-btn.secondary { background: transparent; }
`;

const TWEAK_STORAGE_KEY = 'comparador.tweaks';

function useTweaks(defaults) {
  const [values, setValues] = React.useState(() => {
    try {
      const raw = localStorage.getItem(TWEAK_STORAGE_KEY);
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch { return defaults; }
  });
  const setTweak = React.useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null ? keyOrEdits : { [keyOrEdits]: val };
    setValues(prev => {
      const next = { ...prev, ...edits };
      try { localStorage.setItem(TWEAK_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return [values, setTweak];
}

function TweaksPanel({ title = 'Preferências', children }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <style>{__TWEAKS_STYLE}</style>
      <button className="twk-fab" onClick={() => setOpen(o => !o)} title="Preferências">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      {open && (
        <div className="twk-panel">
          <div className="twk-hd">
            <b>{title}</b>
            <button className="twk-x" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="twk-body">{children}</div>
        </div>
      )}
    </>
  );
}

function TweakSection({ label }) {
  return <div className="twk-sect">{label}</div>;
}

function TweakRow({ label, value, children, inline = false }) {
  return (
    <div className={inline ? 'twk-row twk-row-h' : 'twk-row'}>
      <div className="twk-lbl">
        <span>{label}</span>
        {value != null && <span className="twk-val">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function TweakSlider({ label, value, min = 0, max = 100, step = 1, unit = '', onChange }) {
  return (
    <TweakRow label={label} value={`${value}${unit}`}>
      <input type="range" className="twk-slider" min={min} max={max} step={step}
             value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </TweakRow>
  );
}

function TweakToggle({ label, value, onChange }) {
  return (
    <div className="twk-row twk-row-h">
      <div className="twk-lbl"><span>{label}</span></div>
      <button type="button" className="twk-toggle" data-on={value ? '1' : '0'}
              role="switch" aria-checked={!!value} onClick={() => onChange(!value)}><i /></button>
    </div>
  );
}

function TweakRadio({ label, value, options, onChange }) {
  const opts = options.map(o => (typeof o === 'object' ? o : { value: o, label: o }));
  return (
    <TweakRow label={label}>
      <div className="twk-seg">
        {opts.map(o => (
          <button key={o.value} type="button" className={o.value === value ? 'on' : ''}
                  onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </TweakRow>
  );
}

function TweakButton({ label, onClick, secondary = false }) {
  return (
    <button type="button" className={secondary ? 'twk-btn secondary' : 'twk-btn'}
            onClick={onClick}>{label}</button>
  );
}

Object.assign(window, { useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider, TweakToggle, TweakRadio, TweakButton });
