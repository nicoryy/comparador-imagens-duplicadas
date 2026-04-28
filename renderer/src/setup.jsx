// Setup wizard — 3 passos: arquivo → folha → mapeamento de colunas
// Toda integração via window.electronAPI (preload).

const { useState: useSetupState, useEffect: useSetupEffect, useRef: useSetupRef } = React;

const SetupWizard = ({ onComplete, initialError }) => {
  const [step, setStep] = useSetupState(1);
  const [file, setFile] = useSetupState(null);                 // { path, name, size, modified }
  const [sheets, setSheets] = useSetupState([]);
  const [sheet, setSheet] = useSetupState(null);
  const [columns, setColumns] = useSetupState([]);             // [{ letter, header, label, col }]
  const [mapping, setMapping] = useSetupState({});
  const [recents, setRecents] = useSetupState(() => loadRecents());
  const [busy, setBusy] = useSetupState(false);
  const [error, setError] = useSetupState(initialError || null);

  const dragRef = useSetupRef(null);

  useSetupEffect(() => { setRecents(loadRecents()); }, []);

  // Drag-and-drop on the dropzone
  useSetupEffect(() => {
    const el = dragRef.current;
    if (!el) return;
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    const enter = (e) => { stop(e); el.classList.add('dragover'); };
    const leave = (e) => { stop(e); el.classList.remove('dragover'); };
    const drop = async (e) => {
      stop(e);
      el.classList.remove('dragover');
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      const filePath = f.path; // disponível em Electron
      if (!filePath) {
        setError('Não foi possível ler o caminho do arquivo arrastado.');
        return;
      }
      await selectFile({
        path: filePath,
        name: f.name,
        size: f.size,
        modified: f.lastModified,
      });
    };
    el.addEventListener('dragenter', enter);
    el.addEventListener('dragover', enter);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('dragenter', enter);
      el.removeEventListener('dragover', enter);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('drop', drop);
    };
  }, []);

  const pickViaDialog = async () => {
    setError(null);
    try {
      const result = await window.electronAPI.pickSpreadsheet();
      if (result) await selectFile(result);
    } catch (e) {
      setError(`Falha ao abrir o diálogo: ${e.message || e}`);
    }
  };

  const selectFile = async (f) => {
    setBusy(true); setError(null);
    try {
      const list = await window.electronAPI.listSheets(f.path);
      setFile(f);
      setSheets(list || []);
      setSheet(null);
      setColumns([]);
      pushRecent(f);
      setRecents(loadRecents());
    } catch (e) {
      setError(`Não foi possível ler a planilha: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const selectSheet = async (sheetName) => {
    setBusy(true); setError(null);
    try {
      const cols = await window.electronAPI.listColumns({ filePath: file.path, sheet: sheetName });
      setSheet(sheetName);
      setColumns(cols || []);
      // Tentar auto-mapear pelo nome do header
      const autoMap = autoMatchColumns(cols || []);
      setMapping(prev => ({ ...autoMap, ...prev }));
    } catch (e) {
      setError(`Não foi possível ler as colunas: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const requiredFilled = REQUIRED_COLS.filter(c => c.required).every(c => !!mapping[c.key]);
  const canNext =
    (step === 1 && !!file && !busy) ||
    (step === 2 && !!sheet && !busy) ||
    (step === 3 && requiredFilled && !busy);

  const goNext = async () => {
    if (step === 1) setStep(2);
    else if (step === 2) {
      if (!columns.length) await selectSheet(sheet);
      setStep(3);
    } else {
      onComplete({ file, sheet, mapping, columns });
    }
  };
  const goBack = () => { if (step > 1) setStep(step - 1); setError(null); };

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="setup-head">
          <div className="sb-logo"></div>
          <div>
            <h1>Configurar auditoria</h1>
            <div className="subtitle">Conecte sua planilha, escolha a folha e mapeie as colunas para começar.</div>
          </div>
        </div>

        <div className="setup-stepper">
          {['Selecionar arquivo', 'Escolher folha', 'Mapear colunas'].map((label, i) => {
            const idx = i + 1;
            const cls = idx === step ? 'active' : idx < step ? 'done' : '';
            return (
              <div key={label} className={`setup-step ${cls}`}>
                <div className="n">{idx < step ? '✓' : idx}</div>
                <span>{label}</span>
              </div>
            );
          })}
        </div>

        <div className="setup-body">
          {error && (
            <div className="setup-error">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>{error}</span>
            </div>
          )}

          {step === 1 && (
            <>
              <div>
                <h2>Selecione a planilha</h2>
                <div className="help">Aceitos: <b>.xlsx</b>, <b>.xlsm</b>, <b>.csv</b>. O arquivo é processado localmente; nada é enviado para a internet.</div>
              </div>
              <div className="dropzone" ref={dragRef} onClick={pickViaDialog}>
                <div className="ico">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
                <div className="title">{busy ? 'Lendo planilha…' : 'Arraste o arquivo aqui ou clique para escolher'}</div>
                <div className="sub">Sua planilha permanece neste dispositivo</div>
              </div>
              {recents.length > 0 && (
                <div className="recent-files">
                  <div className="lbl">Recentes</div>
                  {recents.map(f => (
                    <div key={f.path} className={`file-row ${file?.path === f.path ? 'selected' : ''}`}
                         onClick={() => selectFile(f)}>
                      <span className="ico">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      </span>
                      <span className="name" title={f.path}>{f.name}</span>
                      <span className="meta">{formatBytes(f.size)}</span>
                      <span className="meta">{formatRelative(f.lastUsed || f.modified)}</span>
                      <span className="arrow">›</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <h2>Escolha a folha de trabalho</h2>
                <div className="help">A planilha <b>{file?.name}</b> contém {sheets.length} {sheets.length === 1 ? 'folha' : 'folhas'}. Selecione qual será auditada.</div>
              </div>
              {sheets.length === 0 ? (
                <div className="setup-error">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                  <span>Nenhuma folha legível encontrada.</span>
                </div>
              ) : (
                <div className="sheet-grid">
                  {sheets.map((s, i) => (
                    <button key={s.name} className={`sheet-tile ${sheet === s.name ? 'selected' : ''}`}
                            onClick={() => selectSheet(s.name)} disabled={busy}>
                      <div className="nm">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                        {s.name}
                        {i === 0 && <span className="badge">primeira folha</span>}
                      </div>
                      <div className="meta">{s.rowCount} linhas · {s.columnCount} colunas</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <h2>Mapeie as colunas</h2>
                <div className="help">Indique qual coluna da folha <b>{sheet}</b> corresponde a cada campo. Campos opcionais aparecem como tooltips no comparador.</div>
              </div>
              <div className="col-map">
                {REQUIRED_COLS.map(col => (
                  <div className="col-row" key={col.key}>
                    <div className="lbl">
                      {col.label}
                      {col.required ? <span className="req">obrigatório</span> : <span className="opt">opcional</span>}
                    </div>
                    <div className="desc">{col.desc}</div>
                    <select className="col-select"
                            value={mapping[col.key] || ''}
                            onChange={(e) => setMapping({ ...mapping, [col.key]: e.target.value || null })}>
                      <option value="">— não mapear —</option>
                      {columns.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="preview-block">
                <div className="pv-row"><span className="pv-key">Arquivo</span><span className="pv-val">{file?.name}</span></div>
                <div className="pv-row"><span className="pv-key">Caminho</span><span className="pv-val">{file?.path}</span></div>
                <div className="pv-row"><span className="pv-key">Folha</span><span className="pv-val">{sheet}</span></div>
                <div className="pv-row"><span className="pv-key">Colunas detectadas</span><span className="pv-val">{columns.length}</span></div>
              </div>
            </>
          )}
        </div>

        <div className="setup-foot">
          <div className="left">
            {step === 1 && (busy ? 'Lendo planilha…' : 'Passo 1 de 3 · selecione um arquivo')}
            {step === 2 && (busy ? 'Lendo colunas…' : `Arquivo: ${file?.name}`)}
            {step === 3 && `${sheet} · ${REQUIRED_COLS.filter(c => mapping[c.key]).length} de ${REQUIRED_COLS.length} colunas mapeadas`}
          </div>
          <div className="right">
            {step > 1 && <button className="btn" onClick={goBack} disabled={busy}>← Voltar</button>}
            <button className="btn btn-primary" onClick={goNext} disabled={!canNext}>
              {step < 3 ? 'Continuar →' : 'Iniciar auditoria'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Tenta inferir o mapeamento inicial a partir do nome dos cabeçalhos.
function autoMatchColumns(columns) {
  const map = {};
  const norm = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const heuristics = {
    imagem:     ['imagem', 'foto', 'print', 'screenshot', 'url', 'caminho', 'path', 'image'],
    grupo:      ['grupo', 'group', 'cluster', 'lote', 'grp'],
    manter:     ['manter', 'keep', 'principal', 'master'],
    duplicada:  ['duplicada', 'duplicado', 'duplicate', 'dup', 'descartar'],
    id:         ['id', 'codigo', 'code', 'identifier'],
    circuito:   ['circuito', 'circuit', 'rota', 'route'],
    observacao: ['observacao', 'observation', 'obs', 'nota', 'note', 'comentario'],
    data:       ['data', 'date', 'datahora', 'timestamp', 'criado', 'captura'],
  };
  for (const col of columns) {
    const h = norm(col.header);
    if (!h) continue;
    for (const [key, terms] of Object.entries(heuristics)) {
      if (map[key]) continue;
      if (terms.some(t => h.includes(t))) {
        map[key] = col.label;
        break;
      }
    }
  }
  return map;
}

window.SetupWizard = SetupWizard;
window.autoMatchColumns = autoMatchColumns;
