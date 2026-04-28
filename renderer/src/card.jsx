// Cartão de imagem no grid de comparação (imagem real, dados reais).

const Card = React.memo(function Card({ img, idx, status, focused, comparePick, onSetStatus, onFocus, onZoom, onMenu, menuOpen, onMenuAction, mapping }) {
  const isKeep = status === 'keep';
  const isDup = status === 'dup';
  const chipRef = React.useRef(null);
  const [chipRect, setChipRect] = React.useState(null);
  const [imgLoaded, setImgLoaded] = React.useState(false);

  const cardClass = ['card',
    focused && 'focused',
    isKeep && 'keep',
    isDup && 'dup',
    comparePick && 'compare-pick',
  ].filter(Boolean).join(' ');

  const meta = img.meta || {};
  const showId   = !!mapping?.id;
  const showCir  = !!mapping?.circuito;
  const showObs  = !!mapping?.observacao;
  const showData = !!mapping?.data;
  const hasAnyValue = !!(meta.ID || meta.CIRCUITO || meta.OBSERVACAO || meta.DATA);
  const anyMeta  = (showId || showCir || showObs || showData) && hasAnyValue;

  const { src, state: srcState, candidates, activeIdx, setActiveIdx } = useResolvedImageSrc(img);
  React.useEffect(() => { setImgLoaded(false); }, [src]);
  const imgState = srcState === 'loading' ? 'loading' : (srcState === 'error' ? 'error' : (imgLoaded ? 'loaded' : 'loading'));

  return (
    <div className={cardClass} onClick={() => onFocus(idx)}>
      <div className="card-top">
        <div className="badge-num mono">{idx + 1}</div>
        <div className="status-dot">
          {isKeep && (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>)}
          {isDup && (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>)}
        </div>
      </div>

      <div className="image-frame" onDoubleClick={(e) => { e.stopPropagation(); onZoom(idx); }}>
        {src && (
          <img
            className="real"
            src={src}
            alt={meta.ID || `imagem ${idx + 1}`}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgLoaded(false)}
            style={{ visibility: imgState === 'loaded' ? 'visible' : 'hidden' }}
          />
        )}
        {imgState === 'loading' && <div className="img-skeleton"></div>}
        {imgState === 'error' && (
          <div className="img-error">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <div>Imagem não encontrada</div>
            <div style={{ marginTop: 4, opacity: 0.7 }}>{img.imageRaw}</div>
          </div>
        )}

        {candidates.length > 1 && (
          <div className="img-pager" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setActiveIdx(i => Math.max(0, i - 1))} disabled={activeIdx === 0} title="Imagem anterior">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span className="label">{activeIdx + 1}<span className="total">/{candidates.length}</span></span>
            <button onClick={() => setActiveIdx(i => Math.min(candidates.length - 1, i + 1))} disabled={activeIdx === candidates.length - 1} title="Próxima imagem">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        )}

        {anyMeta && (
          <div ref={chipRef} className="meta-chip"
               onMouseEnter={() => { if (chipRef.current) setChipRect(chipRef.current.getBoundingClientRect()); }}
               onMouseLeave={() => setChipRect(null)}
               onClick={(e) => e.stopPropagation()}>
            {showId && meta.ID && <span className="id">{meta.ID}</span>}
            {showCir && meta.CIRCUITO && <span className="cir">{meta.CIRCUITO}</span>}
            {showData && !showCir && meta.DATA && <span className="when">{formatTime(meta.DATA)}</span>}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--fg-3)', flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          </div>
        )}
        {anyMeta && chipRect && (
          <MetaTooltip rect={chipRect} meta={meta} mapping={mapping} />
        )}
      </div>

      <div className="card-bottom">
        {!isKeep && !isDup && (
          <>
            <button className="card-action keep half" onClick={(e) => { e.stopPropagation(); onSetStatus(idx, 'keep'); }}>
              <span>Manter</span><span className="kbd mono">M</span>
            </button>
            <button className="card-action dup half" onClick={(e) => { e.stopPropagation(); onSetStatus(idx, 'dup'); }}>
              <span>Duplicada</span><span className="kbd mono">D</span>
            </button>
          </>
        )}
        {isKeep && (
          <button className="card-action keep" onClick={(e) => { e.stopPropagation(); onSetStatus(idx, null); }}>
            <span>Mantida ✓</span><span className="kbd mono">M</span>
          </button>
        )}
        {isDup && (
          <button className="card-action dup" onClick={(e) => { e.stopPropagation(); onSetStatus(idx, null); }}>
            <span>Duplicada ✕</span><span className="kbd mono">D</span>
          </button>
        )}
        <button className="card-menu" onClick={(e) => { e.stopPropagation(); onMenu(idx); }} title="Mais ações">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
        </button>
      </div>

      {menuOpen && (
        <div className="card-popover" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { onMenuAction('zoom', idx); onMenu(null); }}>
            <span className="ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/></svg></span>
            Ampliar imagem
          </button>
          <button onClick={() => { onMenuAction('compare', idx); onMenu(null); }}>
            <span className="ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="8" height="18"/><rect x="13" y="3" width="8" height="18"/></svg></span>
            Comparar lado a lado
          </button>
          <button onClick={() => { onMenuAction('meta', idx); onMenu(null); }}>
            <span className="ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></span>
            Ver metadados
          </button>
          <button onClick={() => { onMenuAction('reveal', idx); onMenu(null); }}>
            <span className="ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>
            Mostrar caminho do arquivo
          </button>
        </div>
      )}
    </div>
  );
});

// Classifica a fonte da imagem:
//   - direct      : extensão de imagem comum, vai direto pro <img src="...">
//   - remote-page : URL http(s) sem extensão de imagem (provável HTML de galeria) → resolver remoto
//   - local       : caminho local → app-image://local/<base64url>
const IMG_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|tiff?|avif)(\?.*)?$/i;
function classifyImage(absPath, raw) {
  const candidate = (absPath || raw || '').trim();
  if (!candidate) return { kind: 'none', url: null };
  if (/^data:/i.test(candidate)) return { kind: 'direct', url: candidate };
  if (/^app-image:\/\//i.test(candidate)) return { kind: 'direct', url: candidate };
  if (/^https?:\/\//i.test(candidate)) {
    return { kind: IMG_EXT_RE.test(candidate) ? 'direct' : 'remote-page', url: candidate };
  }
  // path local
  try {
    const utf8 = unescape(encodeURIComponent(String(candidate)));
    const b64 = btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return { kind: 'local', url: `app-image://local/${b64}` };
  } catch {
    return { kind: 'none', url: null };
  }
}
function buildImageUrl(absPath, raw) { return classifyImage(absPath, raw).url; }

// Cache de URL-da-página → URL-da-imagem-resolvida; evita IPC repetido entre renders.
const __remoteResolveCache = new Map(); // pageUrl -> Promise<{ ok, url }>
function resolveRemoteCached(pageUrl) {
  if (!pageUrl) return Promise.resolve({ ok: false });
  if (__remoteResolveCache.has(pageUrl)) return __remoteResolveCache.get(pageUrl);
  const p = window.electronAPI.resolveRemoteImage(pageUrl).catch(err => ({ ok: false, error: String(err) }));
  __remoteResolveCache.set(pageUrl, p);
  return p;
}

// Hook React: dado um `img`, devolve { src, state, candidates, activeIdx, setActiveIdx }.
// Para URLs locais/diretas, candidates = [{ url, size: 0 }] (1 elemento).
// Para 'remote-page', candidates é a lista de imagens extraídas da galeria HTML, ordenada por tamanho.
function useResolvedImageSrc(img) {
  const spec = React.useMemo(() => classifyImage(img?.imagePath, img?.imageRaw), [img?.imagePath, img?.imageRaw]);
  const [candidates, setCandidates] = React.useState(() => {
    if (spec.kind === 'remote-page') return [];
    if (spec.url) return [{ url: spec.url, size: 0 }];
    return [];
  });
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [state, setState] = React.useState(spec.kind === 'remote-page' ? 'loading' : (spec.url ? 'ready' : 'error'));

  React.useEffect(() => {
    let cancelled = false;
    setActiveIdx(0);
    if (spec.kind === 'remote-page') {
      setCandidates([]); setState('loading');
      resolveRemoteCached(spec.url).then(r => {
        if (cancelled) return;
        if (r && r.ok && Array.isArray(r.candidates) && r.candidates.length) {
          setCandidates(r.candidates); setState('ready');
        } else if (r && r.ok && r.url) {
          setCandidates([{ url: r.url, size: 0 }]); setState('ready');
        } else {
          setCandidates([]); setState('error');
        }
      });
    } else if (spec.url) {
      setCandidates([{ url: spec.url, size: 0 }]); setState('ready');
    } else {
      setCandidates([]); setState('error');
    }
    return () => { cancelled = true; };
  }, [spec.kind, spec.url]);

  const src = candidates[activeIdx]?.url || null;
  return { src, state, candidates, activeIdx, setActiveIdx };
}

// Tooltip portado pro document.body — escapa do overflow:hidden do .card / .image-frame.
function MetaTooltip({ rect, meta, mapping }) {
  const TOOLTIP_W_MIN = 220, TOOLTIP_W_MAX = 360, GAP = 8;
  const width = Math.max(TOOLTIP_W_MIN, Math.min(TOOLTIP_W_MAX, rect.width));
  let left = rect.left;
  if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
  const above = rect.top > 160; // tem espaço acima?
  const style = above
    ? { left, bottom: window.innerHeight - rect.top + GAP, width }
    : { left, top: rect.bottom + GAP, width };
  const rows = [];
  if (mapping?.id)         rows.push({ k: 'ID',          v: meta.ID || '—',          mono: true });
  if (mapping?.circuito)   rows.push({ k: 'Circuito',    v: meta.CIRCUITO || '—',    mono: true });
  if (mapping?.data)       rows.push({ k: 'Data',        v: formatDate(meta.DATA),    mono: true });
  if (mapping?.observacao) rows.push({ k: 'Observação',  v: meta.OBSERVACAO || '—',   mono: false });
  return ReactDOM.createPortal(
    <div className="meta-tooltip" style={style}>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <span className="k">{r.k}</span>
          <span className={r.mono ? 'v' : 'v obs'}>{r.v}</span>
        </div>
      ))}
    </div>,
    document.body
  );
}

window.Card = Card;
window.MetaTooltip = MetaTooltip;
window.classifyImage = classifyImage;
window.buildImageUrl = buildImageUrl;
window.resolveRemoteCached = resolveRemoteCached;
window.useResolvedImageSrc = useResolvedImageSrc;
