// Modais: zoom, comparação lado a lado, picker.

const ZoomModal = ({ img, idx, onClose, group, setIdx }) => {
  const [scale, setScale] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const dragRef = React.useRef(null);

  React.useEffect(() => { setScale(1); setPan({ x: 0, y: 0 }); }, [idx]);

  const onMouseDown = (e) => { dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const onMouseUp = () => { dragRef.current = null; };

  const onWheel = (e) => {
    e.preventDefault();
    setScale(s => clamp(s + (e.deltaY > 0 ? -0.1 : 0.1), 0.25, 6));
  };

  const { src, state: srcState } = useResolvedImageSrc(img);
  const meta = img.meta || {};
  const total = group?.images?.length || 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(1100px, 95vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Inspeção · Imagem <span className="mono" style={{ color: 'var(--fg-2)' }}>#{idx + 1} de {total}</span>
            {meta.ID && (
              <span style={{ marginLeft: 12, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--bg-3)', color: 'var(--fg-2)', fontWeight: 500 }} className="mono">
                {meta.ID}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}>‹</button>
            <button className="btn" onClick={() => setIdx(Math.min(total - 1, idx + 1))} disabled={idx === total - 1}>›</button>
            <button className="btn" onClick={() => setScale(s => clamp(s - 0.25, 0.25, 6))}>−</button>
            <span className="zoom-pct mono">{Math.round(scale * 100)}%</span>
            <button className="btn" onClick={() => setScale(s => clamp(s + 0.25, 0.25, 6))}>+</button>
            <button className="btn" onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }}>Ajustar</button>
            <button className="modal-close" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div className="modal-body" onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={onWheel} style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}>
          <div className="zoom-stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transition: dragRef.current ? 'none' : 'transform .15s' }}>
            {srcState === 'loading' && <div style={{ color: 'var(--fg-3)' }}>Resolvendo imagem da galeria…</div>}
            {srcState === 'ready' && src && <img className="real" src={src} alt={meta.ID || ''} draggable={false} />}
            {srcState === 'error' && <div style={{ color: 'var(--fg-3)' }}>Imagem não disponível</div>}
          </div>
        </div>
        <div className="modal-foot">
          <span style={{ display: 'flex', gap: 16 }}>
            {meta.CIRCUITO && <span><b style={{ color: 'var(--accent)' }}>{meta.CIRCUITO}</b></span>}
            {meta.DATA && <span>{formatDate(meta.DATA)}</span>}
            {meta.OBSERVACAO && <span style={{ fontStyle: 'italic', color: 'var(--fg-3)' }}>{meta.OBSERVACAO}</span>}
          </span>
          <span className="mono" style={{ color: 'var(--fg-3)' }}>arraste · roda do mouse · <span style={{ padding: '2px 6px', background: 'var(--bg-3)', borderRadius: 4 }}>Esc</span></span>
        </div>
      </div>
    </div>
  );
};

const CompareModal = ({ a, b, ai, bi, onClose }) => {
  const items = [{ img: a, i: ai }, { img: b, i: bi }];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(1300px, 96vw)', height: 'min(900px, 92vh)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="3" width="8" height="18"/><rect x="13" y="3" width="8" height="18"/></svg>
            Comparação lado a lado
          </div>
          <button className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          <div className="compare-stage">
            {items.map(({ img, i }, k) => (
              <CompareCell key={k} img={img} i={i} />
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <span>Pressione <span className="mono" style={{ padding: '2px 6px', background: 'var(--bg-3)', borderRadius: 4 }}>C</span> em outra imagem para reiniciar a comparação.</span>
          <span className="mono">Esc para fechar</span>
        </div>
      </div>
    </div>
  );
};

const CompareCell = ({ img, i }) => {
  const { src, state } = useResolvedImageSrc(img);
  const m = img.meta || {};
  return (
    <div className="compare-cell">
      <div className="label">Imagem #{i + 1}{m.ID ? ` · ${m.ID}` : ''}</div>
      <div className="compare-img-wrap">
        {state === 'loading' && <div style={{ color: 'var(--fg-3)' }}>Resolvendo imagem…</div>}
        {state === 'ready' && src && <img className="real" src={src} alt={m.ID || ''} draggable={false} />}
        {state === 'error' && <div style={{ color: 'var(--fg-3)' }}>Imagem não disponível</div>}
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {m.CIRCUITO && <span style={{ color: 'var(--accent)' }}>{m.CIRCUITO}</span>}
        {m.DATA && <span>{formatDate(m.DATA)}</span>}
        {m.OBSERVACAO && <span style={{ fontFamily: 'inherit', fontStyle: 'italic' }}>{m.OBSERVACAO}</span>}
      </div>
    </div>
  );
};

const ComparePicker = ({ onCancel }) => (
  <div style={{
    position: 'fixed', bottom: 76, left: '50%', transform: 'translateX(-50%)',
    background: 'var(--bg-3)', border: '1px solid var(--accent-soft)', borderRadius: 10,
    padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
    boxShadow: '0 10px 30px oklch(0 0 0 / 0.4), 0 0 24px var(--accent-glow)', zIndex: 50,
    fontSize: 12.5,
  }}>
    <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)', boxShadow: '0 0 12px var(--accent)' }}></span>
    <span>Selecione a <b>segunda imagem</b> para comparar lado a lado</span>
    <button className="btn" onClick={onCancel}>Cancelar</button>
  </div>
);

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

window.ZoomModal = ZoomModal;
window.CompareModal = CompareModal;
window.ComparePicker = ComparePicker;
