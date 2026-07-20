// Modais: zoom, comparação lado a lado, picker.

const ZoomModal = ({ img, idx, onClose, group, setIdx }) => {
  const [scale, setScale] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const dragRef = React.useRef(null);
  const bodyRef = React.useRef(null);

  React.useEffect(() => { setScale(1); setPan({ x: 0, y: 0 }); }, [idx]);

  const onMouseDown = (e) => { dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const onMouseUp = () => { dragRef.current = null; };

  const { src: resolvedSrc, state: srcState, candidates, activeIdx, setActiveIdx } = useResolvedImageSrc(img);
  const { src, loaded, failed, retryCount, onLoad, onError, manualRetry } = useImageWithRetry(resolvedSrc);
  const meta = img.meta || {};
  const total = group?.images?.length || 0;
  const hasMulti = candidates.length > 1;

  // Wheel nativo (passive: false) pra `preventDefault` funcionar — o onWheel
  // do React é passivo e dispara warning. Ctrl+scroll = zoom; scroll puro
  // alterna candidatos do mesmo ponto. Accumulator suaviza trackpad.
  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const acc = { sum: 0, dir: 0, lastStepAt: 0 };
    const onWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        setScale(s => clamp(s + (e.deltaY > 0 ? -0.1 : 0.1), 0.25, 6));
        return;
      }
      if (candidates.length <= 1) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      if (dir !== acc.dir) { acc.sum = 0; acc.dir = dir; }
      acc.sum += Math.abs(e.deltaY);
      const now = Date.now();
      if (acc.sum < 30 || now - acc.lastStepAt < 80) return;
      acc.sum = 0; acc.lastStepAt = now;
      setActiveIdx(i => Math.max(0, Math.min(candidates.length - 1, i + dir)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [candidates.length, setActiveIdx]);

  // Teclado local em capture-phase: alterna candidatos da imagem atual sem
  // colidir com a navegação entre pontos (ArrowLeft/ArrowRight) tratada
  // pelo App.jsx. Usa ArrowUp/ArrowDown e Shift+ArrowLeft/ArrowRight.
  React.useEffect(() => {
    if (!hasMulti) return;
    const onKey = (e) => {
      if (e.target.matches && e.target.matches('input, textarea, select')) return;
      const prev = (e.key === 'ArrowUp') || (e.shiftKey && e.key === 'ArrowLeft');
      const next = (e.key === 'ArrowDown') || (e.shiftKey && e.key === 'ArrowRight');
      if (!prev && !next) return;
      e.preventDefault();
      e.stopPropagation();
      setActiveIdx(i => {
        if (prev) return Math.max(0, i - 1);
        return Math.min(candidates.length - 1, i + 1);
      });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [hasMulti, candidates.length, setActiveIdx]);

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
        <div ref={bodyRef} className="modal-body" onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} style={{ cursor: dragRef.current ? 'grabbing' : 'grab', position: 'relative' }}>
          {hasMulti && (
            <div className="img-pager modal-pager">
              <button onClick={(e) => { e.stopPropagation(); setActiveIdx(i => Math.max(0, i - 1)); }} disabled={activeIdx === 0} title="Imagem anterior do mesmo ponto (↑ / Shift+←)">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span className="label">{activeIdx + 1}<span className="total">/{candidates.length}</span></span>
              <button onClick={(e) => { e.stopPropagation(); setActiveIdx(i => Math.min(candidates.length - 1, i + 1)); }} disabled={activeIdx === candidates.length - 1} title="Próxima imagem do mesmo ponto (↓ / Shift+→)">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          )}
          <div className="zoom-stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transition: dragRef.current ? 'none' : 'transform .15s' }}>
            {srcState === 'loading' && <div style={{ color: 'var(--fg-3)' }}>Resolvendo imagem da galeria…</div>}
            {srcState === 'ready' && src && !failed && (
              <img className="real" src={src} alt={meta.ID || ''} draggable={false}
                   onLoad={onLoad} onError={onError}
                   style={{ visibility: loaded ? 'visible' : 'hidden' }} />
            )}
            {srcState === 'ready' && !loaded && !failed && (
              <div style={{ color: 'var(--fg-3)' }}>
                {retryCount > 0 ? `Recarregando (tentativa ${retryCount + 1})…` : 'Carregando…'}
              </div>
            )}
            {(srcState === 'error' || failed) && (
              <div style={{ color: 'var(--fg-3)', textAlign: 'center' }}>
                <div>Imagem não disponível</div>
                <button className="btn" style={{ marginTop: 10 }} onClick={(e) => { e.stopPropagation(); manualRetry(); }}>Tentar novamente</button>
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <span style={{ display: 'flex', gap: 16 }}>
            {meta.CIRCUITO && <span><b style={{ color: 'var(--accent)' }}>{meta.CIRCUITO}</b></span>}
            {meta.DATA && <span>{formatDate(meta.DATA)}</span>}
            {meta.OBSERVACAO && <span style={{ fontStyle: 'italic', color: 'var(--fg-3)' }}>{meta.OBSERVACAO}</span>}
          </span>
          <span className="mono" style={{ color: 'var(--fg-3)' }}>
            {hasMulti && <>↑↓ ou scroll alterna · </>}
            ctrl+scroll zoom · arraste · <span style={{ padding: '2px 6px', background: 'var(--bg-3)', borderRadius: 4 }}>Esc</span>
          </span>
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
  const { src: resolvedSrc, state, candidates, activeIdx, setActiveIdx } = useResolvedImageSrc(img);
  const { src, loaded, failed, retryCount, onLoad, onError, manualRetry } = useImageWithRetry(resolvedSrc);
  const m = img.meta || {};
  const hasMulti = candidates.length > 1;
  const wrapRef = React.useRef(null);
  const activeIdxRef = React.useRef(activeIdx);
  React.useEffect(() => { activeIdxRef.current = activeIdx; }, [activeIdx]);

  // Scroll do mouse alterna entre as fotos do mesmo ponto na célula.
  // Listener nativo pra poder preventDefault; libera nas bordas.
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el || candidates.length <= 1) return;
    const acc = { sum: 0, dir: 0, lastStepAt: 0 };
    const onWheel = (e) => {
      const dir = e.deltaY > 0 ? 1 : -1;
      const cur = activeIdxRef.current;
      const atEdge = (dir > 0 && cur >= candidates.length - 1) || (dir < 0 && cur <= 0);
      if (atEdge) return;
      e.preventDefault();
      e.stopPropagation();
      if (dir !== acc.dir) { acc.sum = 0; acc.dir = dir; }
      acc.sum += Math.abs(e.deltaY);
      const now = Date.now();
      if (acc.sum < 30 || now - acc.lastStepAt < 80) return;
      acc.sum = 0; acc.lastStepAt = now;
      setActiveIdx(i => Math.max(0, Math.min(candidates.length - 1, i + dir)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [candidates.length, setActiveIdx]);

  return (
    <div className="compare-cell">
      <div className="label">Imagem #{i + 1}{m.ID ? ` · ${m.ID}` : ''}</div>
      <div ref={wrapRef} className="compare-img-wrap" style={{ position: 'relative' }}>
        {state === 'loading' && <div style={{ color: 'var(--fg-3)' }}>Resolvendo imagem…</div>}
        {state === 'ready' && src && !failed && (
          <img className="real" src={src} alt={m.ID || ''} draggable={false}
               onLoad={onLoad} onError={onError}
               style={{ visibility: loaded ? 'visible' : 'hidden' }} />
        )}
        {state === 'ready' && !loaded && !failed && (
          <div style={{ color: 'var(--fg-3)', position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            {retryCount > 0 ? `Recarregando (${retryCount + 1})…` : 'Carregando…'}
          </div>
        )}
        {(state === 'error' || failed) && (
          <div style={{ color: 'var(--fg-3)', textAlign: 'center' }}>
            <div>Imagem não disponível</div>
            <button className="btn" style={{ marginTop: 8 }} onClick={(e) => { e.stopPropagation(); manualRetry(); }}>Tentar novamente</button>
          </div>
        )}
        {hasMulti && (
          <div className="img-pager">
            <button onClick={(e) => { e.stopPropagation(); setActiveIdx(j => Math.max(0, j - 1)); }} disabled={activeIdx === 0} title="Imagem anterior deste ponto">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span className="label">{activeIdx + 1}<span className="total">/{candidates.length}</span></span>
            <button onClick={(e) => { e.stopPropagation(); setActiveIdx(j => Math.min(candidates.length - 1, j + 1)); }} disabled={activeIdx === candidates.length - 1} title="Próxima imagem deste ponto">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        )}
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
