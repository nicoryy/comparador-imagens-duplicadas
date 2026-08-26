// App principal — orquestra tudo: setup, leitura/gravação da planilha, atalhos, navegação.

const { useState, useEffect, useCallback, useMemo, useRef } = React;

const TWEAK_DEFAULTS = {
  hue: 270,
  density: 'comfortable',
  cols: 6,
  autoSave: true,
};

const App = () => {
  const [setupConfig, setSetupConfig] = useState(null);
  const [groupsData, setGroupsData] = useState(null); // { groups, totalImages, totalRows, columns, accessor }
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [appVersion, setAppVersion] = useState(null);
  useEffect(() => { window.electronAPI?.getVersion?.().then(setAppVersion); }, []);

  const [values, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const { config: hotkeyConfig, setActionKeys: setHotkey, resetAction: resetHotkey, resetAll: resetHotkeysAll } = useHotkeyConfig();
  const [hotkeysModalOpen, setHotkeysModalOpen] = useState(false);

  useEffect(() => {
    if (values.hue != null) {
      document.documentElement.style.setProperty('--hue', String(values.hue));
    }
  }, [values.hue]);

  const [groupIdx, setGroupIdx] = useState(0);
  const [statusByGroup, setStatusByGroup] = useState({});
  const [completedGroups, setCompletedGroups] = useState({});
  const [focusIdx, setFocusIdx] = useState(0);
  const [zoomPct, setZoomPct] = useState(100);
  const [viewMode, setViewMode] = useState('grid');
  const [menuOpenIdx, setMenuOpenIdx] = useState(null);
  const [zoomModal, setZoomModal] = useState(null);
  const [metaModal, setMetaModal] = useState(null);
  const [compareMode, setCompareMode] = useState(null);

  // Persistência
  const [dirtyRows, setDirtyRows] = useState({}); // { rowNumber: 'keep'|'dup'|null }
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [saveError, setSaveError] = useState(null);
  const saveTimerRef = useRef(null);
  const dirtyRef = useRef({});
  const savingRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirtyRows; }, [dirtyRows]);

  // ─── Carregamento da planilha ──────────────────────────────────────────────
  useEffect(() => {
    if (!setupConfig) { setGroupsData(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setLoadError(null);
      try {
        const result = await window.electronAPI.loadGroups({
          filePath: setupConfig.file.path,
          sheet: setupConfig.sheet,
          mapping: setupConfig.mapping,
        });
        if (cancelled) return;
        setGroupsData(result);
        window.GROUPS_DATA = result.groups;
        // pré-povoar status com initialStatus salvo na planilha
        const seed = {};
        result.groups.forEach((g, gi) => {
          const s = {};
          g.images.forEach((img, ii) => {
            if (img.initialStatus) s[ii] = img.initialStatus;
          });
          if (Object.keys(s).length) seed[gi] = s;
        });
        setStatusByGroup(seed);
        // grupos já totalmente classificados na planilha (sessão anterior) entram como concluídos
        const seedDone = {};
        result.groups.forEach((g, gi) => {
          const s = seed[gi] || {};
          if (g.images.length && Object.keys(s).length === g.images.length) seedDone[gi] = true;
        });
        setCompletedGroups(seedDone);
        setGroupIdx(0); setFocusIdx(0);
      } catch (e) {
        if (!cancelled) setLoadError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [setupConfig]);

  const groups = groupsData?.groups || [];
  const totalGroups = groups.length;
  const group = groups[groupIdx];
  const status = statusByGroup[groupIdx] || {};
  const groupSize = group?.images?.length || 0;

  const counts = useMemo(() => {
    const k = Object.values(status).filter(s => s === 'keep').length;
    const d = Object.values(status).filter(s => s === 'dup').length;
    return { keep: k, dup: d, pend: Math.max(0, groupSize - k - d) };
  }, [status, groupSize]);

  const completed = !!completedGroups[groupIdx];
  const dirty = Object.keys(dirtyRows).length > 0;

  // ─── Mutações ──────────────────────────────────────────────────────────────
  const setStatus = useCallback((idx, newStatus) => {
    if (!group) return;
    const img = group.images[idx];
    if (!img) return;
    const rowNumber = img.rowNumber;
    setStatusByGroup(prev => {
      const cur = { ...(prev[groupIdx] || {}) };
      if (newStatus === 'keep' || newStatus === 'dup') cur[idx] = newStatus;
      else delete cur[idx];
      return { ...prev, [groupIdx]: cur };
    });
    setDirtyRows(prev => ({ ...prev, [rowNumber]: newStatus || null }));
  }, [groupIdx, group]);

  const markAllOthersDup = useCallback((keepIdx) => {
    if (!group) return;
    const updates = {};
    const groupStatus = {};
    group.images.forEach((img, i) => {
      const s = i === keepIdx ? 'keep' : 'dup';
      groupStatus[i] = s;
      updates[img.rowNumber] = s;
    });
    setStatusByGroup(prev => ({ ...prev, [groupIdx]: groupStatus }));
    setDirtyRows(prev => ({ ...prev, ...updates }));
  }, [group, groupIdx]);

  const clearGroup = useCallback(() => {
    if (!group) return;
    const updates = {};
    group.images.forEach(img => { updates[img.rowNumber] = null; });
    setStatusByGroup(prev => ({ ...prev, [groupIdx]: {} }));
    setDirtyRows(prev => ({ ...prev, ...updates }));
  }, [group, groupIdx]);

  // ─── Salvamento ────────────────────────────────────────────────────────────
  // Retorna `true` em sucesso (ou se não havia nada a gravar), `false` em erro.
  // O retorno é usado no fluxo "Salvar e fechar" para decidir se a janela pode fechar.
  const saveNow = useCallback(async () => {
    if (!setupConfig) return true;
    if (savingRef.current) return true;
    const dirty = dirtyRef.current;
    if (!dirty || Object.keys(dirty).length === 0) return true;
    savingRef.current = true;
    setSaving(true); setSaveState('saving'); setSaveError(null);
    try {
      await window.electronAPI.saveStatuses({
        filePath: setupConfig.file.path,
        sheet: setupConfig.sheet,
        mapping: setupConfig.mapping,
        statuses: dirty,
        statusLabels: { keep: 'MANTER', dup: 'DUPLICADA', none: '' },
      });
      setDirtyRows(prev => {
        const next = { ...prev };
        for (const k of Object.keys(dirty)) {
          if (next[k] === dirty[k]) delete next[k];
        }
        return next;
      });
      setSaveState('saved');
      setTimeout(() => setSaveState(s => s === 'saved' ? 'idle' : s), 1500);
      return true;
    } catch (err) {
      setSaveState('error');
      setSaveError(err.message || String(err));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [setupConfig]);

  // ─── Navegação entre grupos ────────────────────────────────────────────────
  // Navegação pura — não conclui nem preenche nada. Usada por "voltar" sempre,
  // e internamente por goNext/completeGroup após a finalização já ter rodado.
  const navPrev = useCallback(() => { setGroupIdx(i => Math.max(0, i - 1)); setFocusIdx(0); }, []);
  const navNext = useCallback(() => { setGroupIdx(i => Math.min(totalGroups - 1, i + 1)); setFocusIdx(0); }, [totalGroups]);
  const goPrev = navPrev;

  // Fecha o grupo `gi`: pendentes viram 'keep' e o grupo é marcado como concluído.
  const finalizeGroup = useCallback((gi) => {
    const g = groups[gi];
    if (!g) return;
    const cur = statusByGroup[gi] || {};
    const nextStatus = { ...cur };
    const updates = {};
    g.images.forEach((img, i) => {
      if (nextStatus[i] !== 'keep' && nextStatus[i] !== 'dup') {
        nextStatus[i] = 'keep';
        updates[img.rowNumber] = 'keep';
      }
    });
    if (Object.keys(updates).length) {
      setStatusByGroup(prev => ({ ...prev, [gi]: nextStatus }));
      // Atualiza a ref de forma síncrona: saveNow() lê dirtyRef.current, que só
      // seria sincronizado no próximo render pelo effect que espelha dirtyRows -> dirtyRef.
      dirtyRef.current = { ...dirtyRef.current, ...updates };
      setDirtyRows(prev => ({ ...prev, ...updates }));
    }
    setCompletedGroups(prev => prev[gi] ? prev : { ...prev, [gi]: true });
  }, [groups, statusByGroup]);

  // Avançar: se o grupo atual tem alguma marcação e ainda não foi concluído,
  // finaliza (pendentes -> manter) antes de navegar. Grupo intocado só navega.
  const goNext = useCallback(() => {
    const hasMarks = Object.values(statusByGroup[groupIdx] || {}).some(v => v === 'keep' || v === 'dup');
    if (hasMarks && !completedGroups[groupIdx]) {
      finalizeGroup(groupIdx);
      saveNow();
    }
    navNext();
  }, [groupIdx, statusByGroup, completedGroups, finalizeGroup, saveNow, navNext]);

  const completeGroup = useCallback(() => {
    finalizeGroup(groupIdx);
    saveNow(); // força gravação ao concluir
    setTimeout(() => {
      if (groupIdx < totalGroups - 1) navNext();
    }, 200);
  }, [groupIdx, finalizeGroup, saveNow, navNext, totalGroups]);

  // Reporta estado de gravação ao processo main (usado pra bloquear fechamento).
  useEffect(() => {
    window.electronAPI?.setRenderState?.({ dirty, saving });
  }, [dirty, saving]);

  // Quando o main pede "Salvar e fechar", roda saveNow e confirma o resultado.
  useEffect(() => {
    if (!window.electronAPI?.onSaveBeforeClose) return;
    return window.electronAPI.onSaveBeforeClose(async () => {
      const ok = await saveNow();
      window.electronAPI.confirmCloseAfterSave(ok);
    });
  }, [saveNow]);

  // Auto-save com debounce
  useEffect(() => {
    if (!values.autoSave) return;
    if (!Object.keys(dirtyRows).length) return;
    if (saving) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { saveNow(); }, 800);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [dirtyRows, values.autoSave, saveNow, saving]);

  // ─── Menu / compare flow ───────────────────────────────────────────────────
  const handleMenuAction = useCallback((action, idx, imageIdx) => {
    if (action === 'zoom') setZoomModal({ idx });
    else if (action === 'meta') setMetaModal({ idx, imageIdx });
    else if (action === 'compare') setCompareMode({ firstIdx: idx });
    else if (action === 'reveal' && group) {
      const img = group.images[idx];
      alert(`Caminho da imagem:\n${img.imagePath || img.imageRaw || '—'}`);
    }
  }, [group]);

  const handleFocus = useCallback((idx) => {
    if (compareMode && compareMode.firstIdx != null && compareMode.secondIdx == null && idx !== compareMode.firstIdx) {
      setCompareMode({ ...compareMode, secondIdx: idx });
      return;
    }
    setFocusIdx(idx);
  }, [compareMode]);

  // ─── Atalhos de teclado (resolver config-driven) ───────────────────────────
  // Cards expõem um callback de navegação entre imagens internas via ref-map.
  const cardImageNavRef = useRef({});
  const registerCardImageNav = useCallback((cardIdx, fn) => {
    if (fn) cardImageNavRef.current[cardIdx] = fn;
    else delete cardImageNavRef.current[cardIdx];
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches('input,textarea,select')) return;
      const action = resolveAction(e, hotkeyConfig);

      // Modais têm prioridade — capturam fechar e navegação local.
      if (zoomModal) {
        if (action === 'close-modal') { e.preventDefault(); setZoomModal(null); return; }
        if (action === 'nav-image-prev') { e.preventDefault(); setZoomModal(z => z && z.idx > 0 ? { idx: z.idx - 1 } : z); return; }
        if (action === 'nav-image-next') { e.preventDefault(); setZoomModal(z => z && z.idx < groupSize - 1 ? { idx: z.idx + 1 } : z); return; }
        return;
      }
      if (metaModal) {
        if (action === 'close-modal') { e.preventDefault(); setMetaModal(null); }
        return;
      }
      if (compareMode && action === 'close-modal') { e.preventDefault(); setCompareMode(null); return; }

      // Seleção de card por número (1–9, 0) — fixo, não configurável.
      if (/^[1-9]$/.test(e.key)) { e.preventDefault(); setFocusIdx(Math.min(groupSize - 1, parseInt(e.key, 10) - 1)); return; }
      if (e.key === '0' && groupSize >= 10) { e.preventDefault(); setFocusIdx(9); return; }

      if (!action) return;
      switch (action) {
        case 'mark-keep':      e.preventDefault(); setStatus(focusIdx, status[focusIdx] === 'keep' ? null : 'keep'); break;
        case 'mark-dup':       e.preventDefault(); setStatus(focusIdx, status[focusIdx] === 'dup' ? null : 'dup'); break;
        case 'next-group':     e.preventDefault(); goNext(); break;
        case 'prev-group':     e.preventDefault(); goPrev(); break;
        case 'zoom':           e.preventDefault(); setZoomModal({ idx: focusIdx }); break;
        case 'compare':        e.preventDefault(); setCompareMode({ firstIdx: focusIdx }); break;
        case 'save-now':       e.preventDefault(); saveNow(); break;
        case 'complete-group':
          if (!completed) { e.preventDefault(); completeGroup(); }
          break;
        case 'nav-image-prev':
          e.preventDefault();
          cardImageNavRef.current[focusIdx]?.(-1);
          break;
        case 'nav-image-next':
          e.preventDefault();
          cardImageNavRef.current[focusIdx]?.(+1);
          break;
        case 'nav-card-up':
          e.preventDefault();
          setFocusIdx(i => Math.max(0, i - (values.cols || 6)));
          break;
        case 'nav-card-down':
          e.preventDefault();
          setFocusIdx(i => Math.min(groupSize - 1, i + (values.cols || 6)));
          break;
        default: /* no-op */
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusIdx, status, setStatus, goNext, goPrev, zoomModal, metaModal, compareMode, groupSize, values.cols, completed, completeGroup, saveNow, hotkeyConfig]);

  // Fecha menu de card ao clicar fora
  const onMenu = (idx) => setMenuOpenIdx(prev => prev === idx ? null : idx);
  useEffect(() => {
    const close = () => setMenuOpenIdx(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  // ─── Comparação calculada ──────────────────────────────────────────────────
  const compareImages = compareMode && compareMode.secondIdx != null && group
    ? { a: group.images[compareMode.firstIdx], ai: compareMode.firstIdx,
        b: group.images[compareMode.secondIdx], bi: compareMode.secondIdx }
    : null;

  // ─── Render ────────────────────────────────────────────────────────────────
  if (!setupConfig) {
    return <SetupWizard onComplete={(cfg) => setSetupConfig(cfg)} appVersion={appVersion} />;
  }

  if (loading) {
    return (
      <div className="loader-overlay">
        <div className="loader-card">
          <div className="spinner"></div>
          <div className="msg">Lendo planilha…</div>
          <div className="sub mono">{setupConfig.file?.name} · {setupConfig.sheet}</div>
        </div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="loader-overlay">
        <div className="loader-card error">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--dup)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div className="msg">Erro ao carregar a planilha</div>
          <div className="sub">{loadError}</div>
          <button className="btn" onClick={() => setSetupConfig(null)}>Reconfigurar</button>
        </div>
      </div>
    );
  }
  if (!group) {
    return (
      <div className="loader-overlay">
        <div className="loader-card">
          <div className="msg">Nenhum grupo encontrado</div>
          <div className="sub">A folha selecionada não contém grupos válidos.</div>
          <button className="btn" onClick={() => setSetupConfig(null)}>Reconfigurar</button>
        </div>
      </div>
    );
  }

  const cols = Math.max(2, Math.min(8, Number(values.cols) || 6));

  return (
    <div className="app" data-screen-label="Comparador">
      <Sidebar
        group={group}
        groupIdx={groupIdx}
        totalGroups={totalGroups}
        status={status}
        allStatus={statusByGroup}
        completedGroups={completedGroups}
        fileInfo={setupConfig}
        appVersion={appVersion}
        hotkeyConfig={hotkeyConfig}
        onOpenZoom={() => setZoomModal({ idx: focusIdx })}
        onReconfigure={() => setSetupConfig(null)}
      />
      <Header
        groupIdx={groupIdx}
        totalGroups={totalGroups}
        group={group}
        onPrev={goPrev}
        onNext={goNext}
        onComplete={completeGroup}
        viewMode={viewMode}
        setViewMode={setViewMode}
        completed={completed}
        dirty={dirty}
        onSave={saveNow}
        saving={saving}
        hotkeyConfig={hotkeyConfig}
      />
      <main className="main">
        <div className="batch-bar">
          <div className="left">
            <span className="pill">
              <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }}></span>
              <span>Imagem ativa</span>
              <span className="num">#{focusIdx + 1}</span>
            </span>
            <span className="pill"><span style={{ color: 'var(--keep)' }}>●</span> <span className="num">{counts.keep}</span> manter</span>
            <span className="pill"><span style={{ color: 'var(--dup)' }}>●</span> <span className="num">{counts.dup}</span> duplicadas</span>
            <span className="pill"><span style={{ color: 'var(--fg-3)' }}>●</span> <span className="num">{counts.pend}</span> pendentes</span>
          </div>
          <div className="right">
            {counts.keep === 1 && counts.pend > 0 && (
              <button className="link-btn" onClick={() => {
                const keepIdx = Object.keys(status).find(k => status[k] === 'keep');
                if (keepIdx != null) markAllOthersDup(parseInt(keepIdx, 10));
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Marcar restantes como duplicadas
              </button>
            )}
            <button className="link-btn" onClick={clearGroup}>Limpar grupo</button>
          </div>
        </div>

        <div className="grid-wrap">
          <div className={`grid ${viewMode === 'compact' ? 'compact' : ''}`}
               style={{
                 '--cols': cols,
                 transform: `scale(${zoomPct/100})`,
                 transformOrigin: 'top left',
                 width: `${10000/zoomPct}%`,
                 height: `${10000/zoomPct}%`,
               }}>
            {group.images.map((img, idx) => (
              <Card
                key={img.id}
                img={img}
                idx={idx}
                status={status[idx]}
                focused={focusIdx === idx}
                comparePick={compareMode && (compareMode.firstIdx === idx)}
                onSetStatus={setStatus}
                onFocus={handleFocus}
                onZoom={(i) => setZoomModal({ idx: i })}
                onMenu={onMenu}
                menuOpen={menuOpenIdx === idx}
                onMenuAction={handleMenuAction}
                mapping={setupConfig.mapping}
                onRegisterImageNav={registerCardImageNav}
                hotkeyConfig={hotkeyConfig}
              />
            ))}
          </div>
        </div>
      </main>
      <Footer
        zoom={zoomPct}
        setZoom={setZoomPct}
        onPrev={goPrev}
        onNext={goNext}
        groupIdx={groupIdx}
        totalGroups={totalGroups}
        hotkeyConfig={hotkeyConfig}
      />

      {compareMode && compareMode.secondIdx == null && (
        <ComparePicker onCancel={() => setCompareMode(null)} />
      )}
      {compareImages && (
        <CompareModal {...compareImages} onClose={() => setCompareMode(null)} />
      )}
      {zoomModal && group.images[zoomModal.idx] && (
        <ZoomModal
          img={group.images[zoomModal.idx]}
          idx={zoomModal.idx}
          group={group}
          setIdx={(i) => setZoomModal({ idx: i })}
          onClose={() => setZoomModal(null)}
        />
      )}
      {metaModal && group.images[metaModal.idx] && (
        <MetaModal
          img={group.images[metaModal.idx]}
          idx={metaModal.idx}
          group={group}
          initialImageIdx={metaModal.imageIdx}
          mapping={setupConfig.mapping}
          onClose={() => setMetaModal(null)}
        />
      )}

      <SaveIndicator state={saveState} dirty={dirty} error={saveError} />

      {hotkeysModalOpen && (
        <HotkeysModal
          config={hotkeyConfig}
          onSetKeys={setHotkey}
          onResetAction={resetHotkey}
          onResetAll={resetHotkeysAll}
          onClose={() => setHotkeysModalOpen(false)}
        />
      )}

      <TweaksPanel title="Preferências">
        <TweakSection label="Aparência" />
        <TweakSlider label="Tom de acento" value={values.hue} min={0} max={360} step={5} unit="°"
          onChange={(v) => setTweak('hue', v)} />
        <TweakRadio label="Densidade" value={values.density}
          options={['comfortable', 'compact']}
          onChange={(v) => { setTweak('density', v); setViewMode(v === 'compact' ? 'compact' : 'grid'); }} />
        <TweakSlider label="Colunas no grid" value={values.cols} min={2} max={8} step={1}
          onChange={(v) => setTweak('cols', v)} />

        <TweakSection label="Gravação" />
        <TweakToggle label="Salvar automaticamente" value={values.autoSave}
          onChange={(v) => setTweak('autoSave', v)} />
        <TweakButton label="Salvar agora" onClick={saveNow} />

        <TweakSection label="Atalhos" />
        <TweakButton label="Configurar atalhos…" onClick={() => setHotkeysModalOpen(true)} />

        <TweakSection label="Grupo atual" />
        <TweakButton label="Manter 1ª, duplicar demais" onClick={() => markAllOthersDup(0)} />
        <TweakButton label="Limpar classificações" secondary onClick={clearGroup} />
        <TweakButton label="Reconfigurar planilha" secondary onClick={() => setSetupConfig(null)} />
      </TweaksPanel>
    </div>
  );
};

const SaveIndicator = ({ state, dirty, error }) => {
  if (state === 'idle' && !dirty) return null;
  let cls = 'save-indicator', label = '';
  if (state === 'saving') { cls += ' saving'; label = 'Salvando…'; }
  else if (state === 'saved') { cls += ' saved'; label = 'Salvo na planilha'; }
  else if (state === 'error') { cls += ' error'; label = `Erro: ${error || 'falha ao gravar'}`; }
  else if (dirty) { label = 'Alterações pendentes'; }
  const spin = state === 'saving' ? 'spin' : '';
  return (
    <div className={cls}>
      <span className={`dot ${spin}`}></span>
      <span>{label}</span>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
