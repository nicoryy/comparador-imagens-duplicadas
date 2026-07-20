// Sidebar, header, footer (chrome do app).

const Sidebar = ({ group, groupIdx, totalGroups, status, allStatus, completedGroups, fileInfo, appVersion, onOpenZoom, onReconfigure }) => {
  const groupSize = group?.images?.length || 0;
  const counts = {
    keep: Object.values(status).filter(s => s === 'keep').length,
    dup:  Object.values(status).filter(s => s === 'dup').length,
  };
  counts.pend = Math.max(0, groupSize - counts.keep - counts.dup);

  // Progresso global: itera todos os grupos
  let totalImages = 0, gKeep = 0, gDup = 0, gPend = 0, gComplete = 0;
  for (let i = 0; i < totalGroups; i++) {
    const g = window.GROUPS_DATA?.[i];
    const n = g?.images?.length || 0;
    totalImages += n;
    const s = allStatus[i] || {};
    const k = Object.values(s).filter(v => v === 'keep').length;
    const d = Object.values(s).filter(v => v === 'dup').length;
    gKeep += k; gDup += d; gPend += Math.max(0, n - k - d);
    if (completedGroups[i]) gComplete++;
  }
  const groupsPct = totalGroups ? Math.round((gComplete / totalGroups) * 100) : 0;
  const imagesPct = totalImages ? Math.round(((gKeep + gDup) / totalImages) * 100) : 0;

  return (
    <aside className="sidebar">
      <div className="sb-identity">
        <div className="sb-logo"></div>
        <div>
          <div className="sb-title">Comparador de Imagens</div>
          <div className="sb-subtitle">Análise manual de duplicidades</div>
        </div>
      </div>

      <div className="sb-scroll">
        <div className="sb-block file-block">
          <div className="sb-label"><span className="sb-label-dot"></span> Fonte de dados</div>
          <div className="file-info">
            <div className="file-name" title={fileInfo?.file?.path || fileInfo?.file?.name}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--keep)" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>{fileInfo?.file?.name || '—'}</span>
            </div>
            <div className="file-meta">
              <span>{fileInfo?.sheet}</span><span>·</span><span>{totalGroups} grupos · {totalImages} imagens</span>
            </div>
            <button className="link-btn" style={{ alignSelf: 'flex-start', padding: '2px 0', fontSize: 11 }} onClick={onReconfigure}>
              Reconfigurar
            </button>
          </div>
        </div>

        <div className="sb-block">
          <div className="sb-label"><span className="sb-label-dot"></span> Progresso geral</div>

          <div className="progress-line">
            <div className="prog-row">
              <span className="prog-lbl">Grupos concluídos</span>
              <span className="prog-val mono">{gComplete}<span className="of">/{totalGroups}</span></span>
            </div>
            <div className="prog-bar"><div style={{ width: `${groupsPct}%`, background: 'var(--accent)' }}></div></div>
          </div>

          <div className="progress-line">
            <div className="prog-row">
              <span className="prog-lbl">Imagens classificadas</span>
              <span className="prog-val mono">{gKeep + gDup}<span className="of">/{totalImages}</span></span>
            </div>
            <div className="prog-bar split">
              <div style={{ width: `${totalImages ? (gKeep / totalImages) * 100 : 0}%`, background: 'var(--keep)' }}></div>
              <div style={{ width: `${totalImages ? (gDup  / totalImages) * 100 : 0}%`, background: 'var(--dup)' }}></div>
            </div>
          </div>

          <div className="summary-row keep" style={{ marginTop: 4 }}>
            <span className="dot"></span><span className="lbl">Total a manter</span>
            <span className="num" style={{ marginLeft: 'auto' }}>{gKeep}</span>
          </div>
          <div className="summary-row dup">
            <span className="dot"></span><span className="lbl">Total duplicadas</span>
            <span className="num" style={{ marginLeft: 'auto' }}>{gDup}</span>
          </div>
          <div className="summary-row pend">
            <span className="dot"></span><span className="lbl">Pendentes (todos os grupos)</span>
            <span className="num" style={{ marginLeft: 'auto' }}>{gPend}</span>
          </div>
        </div>

        <div className="sb-block">
          <div className="sb-label"><span className="sb-label-dot"></span> Grupo atual</div>
          <div className="summary-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 8 }}>
            <div className="summary-stat">
              <div className="num" style={{ color: 'var(--keep)' }}>{counts.keep}</div>
              <div className="lbl">manter</div>
            </div>
            <div className="summary-stat">
              <div className="num" style={{ color: 'var(--dup)' }}>{counts.dup}</div>
              <div className="lbl">duplicadas</div>
            </div>
            <div className="summary-stat">
              <div className="num">{counts.pend}</div>
              <div className="lbl">pendentes</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>Grupo {groupIdx + 1} · {groupSize} imagens · ID <span className="mono">{group?.id}</span></div>
        </div>

        <div className="sb-block">
          <div className="sb-label"><span className="sb-label-dot"></span> Como usar</div>
          <ol className="steps">
            <li><span className="n">1</span><span>Marque cada imagem como <b style={{ color: 'var(--keep)' }}>manter</b> ou <b style={{ color: 'var(--dup)' }}>duplicada</b>. Várias podem ser mantidas.</span></li>
            <li><span className="n">2</span><span>Use o tooltip de <b>ID/Circuito/Data/Obs.</b> para apoiar a decisão.</span></li>
            <li><span className="n">3</span><span>Use o zoom para inspecionar detalhes finos.</span></li>
            <li><span className="n">4</span><span>Conclua o grupo e avance — gravação automática na planilha.</span></li>
          </ol>
        </div>

        <div className="sb-block">
          <div className="sb-label"><span className="sb-label-dot"></span> Atalhos de teclado</div>
          <div className="hotkeys">
            <div className="hotkey keep"><span className="kbd">M</span><span>Manter imagem</span></div>
            <div className="hotkey dup"><span className="kbd">D</span><span>Marcar duplicada</span></div>
            <div className="hotkey"><span className="kbd">N</span><span>Próximo grupo</span></div>
            <div className="hotkey"><span className="kbd">P</span><span>Grupo anterior</span></div>
            <div className="hotkey"><span className="kbd">1–9</span><span>Selecionar imagem</span></div>
            <div className="hotkey"><span className="kbd">Z</span><span>Abrir zoom</span></div>
            <div className="hotkey"><span className="kbd">C</span><span>Comparar lado a lado</span></div>
            <div className="hotkey"><span className="kbd">⏎</span><span>Concluir grupo</span></div>
            <div className="hotkey"><span className="kbd">⌘S</span><span>Salvar planilha</span></div>
          </div>
        </div>
      </div>

      <div className="sb-foot">
        <button className="btn-real" onClick={onOpenZoom}>
          <span>Ver imagem em tamanho real</span>
          <span className="ico">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/></svg>
          </span>
        </button>
        <div className="sb-foot-status">{appVersion ? `v${appVersion}` : '…'} · Electron build</div>
      </div>
    </aside>
  );
};

const Header = ({ groupIdx, totalGroups, group, onPrev, onNext, onComplete, viewMode, setViewMode, allClassified, completed, dirty, onSave, saving }) => (
  <header className="header">
    <div className="hdr-left">
      <div className="crumb">
        <span>Auditoria</span><span className="sep">/</span>
        <span>Comparador</span><span className="sep">/</span>
        <span className="now">Grupo {groupIdx + 1}</span>
      </div>
    </div>
    <div className="group-nav">
      <button className="nav-btn" onClick={onPrev} disabled={groupIdx === 0} title="Grupo anterior (P)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div className="group-indicator">
        <div className="gnum">Grupo {groupIdx + 1} <span className="of">de {totalGroups}</span></div>
        <div className="gmeta">{group?.images?.length || 0} imagens · ID <span className="mono">{group?.id}</span></div>
      </div>
      <button className="nav-btn" onClick={onNext} disabled={groupIdx === totalGroups - 1} title="Próximo grupo (N)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <div className="hdr-right">
      <div className="toggle-group">
        <button className={viewMode === 'grid' ? 'on' : ''} onClick={() => setViewMode('grid')} title="Grid amplo">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </button>
        <button className={viewMode === 'compact' ? 'on' : ''} onClick={() => setViewMode('compact')} title="Compacto">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>
      <button className="btn" onClick={onSave} disabled={!dirty || saving} title="Salvar agora (Ctrl+S)">
        {saving ? (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity="0.3"/><path d="M12 2 a 10 10 0 0 1 10 10"/></svg>
            Salvando…
          </>
        ) : (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {dirty ? 'Salvar' : 'Salvo'}
          </>
        )}
      </button>
      <button className="btn btn-primary" onClick={onComplete} disabled={!allClassified || completed}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        {completed ? 'Grupo concluído' : 'Concluir grupo'}
      </button>
    </div>
  </header>
);

const Footer = ({ zoom, setZoom, onPrev, onNext, groupIdx, totalGroups }) => (
  <footer className="footer">
    <div className="zoom-cluster">
      <button className="zoom-btn" onClick={() => setZoom(Math.max(50, zoom - 10))} title="Diminuir zoom">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <span className="zoom-pct mono">{zoom}%</span>
      <button className="zoom-btn" onClick={() => setZoom(Math.min(200, zoom + 10))} title="Aumentar zoom">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <span className="divider"></span>
      <button className="btn" onClick={() => setZoom(100)}>Ajustar</button>
      <button className="btn" onClick={() => setZoom(140)}>Preencher</button>
    </div>
    <div className="tip">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>
      <span>Imagens muito similares podem conter pequenas diferenças. Verifique <b style={{ color: 'var(--fg-1)' }}>nitidez, recorte, brilho</b> e elementos da interface.</span>
    </div>
    <div className="fast-nav">
      <button className="btn" onClick={onPrev} disabled={groupIdx === 0}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        Grupo anterior <span className="kbd mono" style={{ fontSize: 10, padding: '1px 5px', background: 'oklch(0 0 0 / 0.4)', borderRadius: 3 }}>P</span>
      </button>
      <button className="btn btn-primary" onClick={onNext} disabled={groupIdx === totalGroups - 1}>
        Próximo grupo <span className="kbd mono" style={{ fontSize: 10, padding: '1px 5px', background: 'oklch(0 0 0 / 0.3)', borderRadius: 3, color: 'oklch(0.2 0.05 145)' }}>N</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  </footer>
);

window.Sidebar = Sidebar;
window.Header = Header;
window.Footer = Footer;
