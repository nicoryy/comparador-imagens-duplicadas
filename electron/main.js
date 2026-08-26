'use strict';

const { app, BrowserWindow, ipcMain, dialog, protocol, net, session, shell, clipboard } = require('electron');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

const isDev = !app.isPackaged;

let mainWindow = null;
let xlsxWorker = null;
const pendingJobs = new Map();
let jobSeq = 0;
// Serializa saves por arquivo. Sem isso, debounce auto-save + saveNow() do
// "completeGroup" podem disparar dois writes simultâneos no mesmo path,
// deixando o tmp em estado inconsistente.
const saveQueues = new Map(); // filePath -> Promise
// Marca de drain no shutdown: quando true, before-quit já esperou e pode terminar.
let quittingAfterDrain = false;

// Estado de gravação reportado pelo renderer. Usado pra bloquear o fechamento
// da janela enquanto há alterações pendentes ou um save em andamento.
let renderState = { dirty: false, saving: false };
// Quando o usuário pediu "Salvar e fechar", aguardamos a confirmação do
// renderer (saveNow concluído) antes de chamar close() de novo.
let forceClosing = false;
let pendingCloseAfterSave = false;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-image',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

function createWorker() {
  if (xlsxWorker) return xlsxWorker;
  xlsxWorker = new Worker(path.join(__dirname, 'workers', 'xlsx-worker.js'));
  xlsxWorker.on('message', (msg) => {
    const job = pendingJobs.get(msg.id);
    if (!job) return;
    pendingJobs.delete(msg.id);
    if (msg.error) job.reject(new Error(msg.error));
    else job.resolve(msg.result);
  });
  xlsxWorker.on('error', (err) => {
    for (const job of pendingJobs.values()) job.reject(err);
    pendingJobs.clear();
    xlsxWorker = null;
  });
  xlsxWorker.on('exit', (code) => {
    xlsxWorker = null;
    if (code !== 0) {
      for (const job of pendingJobs.values()) job.reject(new Error(`Worker saiu com código ${code}`));
      pendingJobs.clear();
    }
  });
  return xlsxWorker;
}

function runWorkerJob(action, payload) {
  const worker = createWorker();
  const id = ++jobSeq;
  return new Promise((resolve, reject) => {
    pendingJobs.set(id, { resolve, reject });
    worker.postMessage({ id, action, payload });
  });
}

// Enfileira saves por filePath: cada novo save só começa depois do anterior
// concluir (sucesso ou erro). Garante atomicidade ponta-a-ponta — o worker
// nunca recebe dois writes concorrentes para o mesmo arquivo.
function enqueueSave(filePath, payload) {
  const prev = saveQueues.get(filePath) || Promise.resolve();
  const next = prev
    .catch(() => { /* erro do anterior não bloqueia o próximo */ })
    .then(() => runWorkerJob('saveStatuses', payload));
  saveQueues.set(filePath, next);
  next.finally(() => {
    if (saveQueues.get(filePath) === next) saveQueues.delete(filePath);
  });
  return next;
}

function hasPendingWork() {
  return pendingJobs.size > 0 || saveQueues.size > 0;
}

function resolveAppImagePath(url) {
  const stripped = url.replace(/^app-image:\/\//, '');
  const decoded = decodeURIComponent(stripped.split('?')[0].split('#')[0]);
  const buf = Buffer.from(decoded, 'base64url');
  return buf.toString('utf8');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#0c0d12',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Intercepta o fechamento (botão X, Alt+F4, app.quit) enquanto houver
  // alterações não salvas ou um save em curso.
  mainWindow.on('close', (e) => {
    if (forceClosing) return;
    if (!renderState.dirty && !renderState.saving) return;

    e.preventDefault();

    // Já pediu "Salvar e fechar" e está aguardando a resposta — não reabra o
    // diálogo se o usuário tentar fechar de novo no meio do processo.
    if (pendingCloseAfterSave) return;

    const message = renderState.saving
      ? 'A planilha ainda está sendo salva.'
      : 'Há alterações que ainda não foram gravadas na planilha.';
    const detail = renderState.saving
      ? 'Fechar agora pode corromper o arquivo. Aguarde a gravação concluir ou feche mesmo assim por sua conta e risco.'
      : 'Recomenda-se salvar antes de fechar para não perder as marcações.';

    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Salvar e fechar', 'Fechar sem salvar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: 'Alterações pendentes',
      message,
      detail,
    });

    if (choice === 0) {
      // Pede ao renderer pra salvar agora; ele responde via IPC e o main
      // reemite close() com forceClosing=true.
      pendingCloseAfterSave = true;
      mainWindow.webContents.send('app:saveBeforeClose');
    } else if (choice === 1) {
      forceClosing = true;
      mainWindow.close();
    }
    // 2 (Cancelar): mantém a janela aberta, sem mais ações.
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  protocol.handle('app-image', (request) => {
    try {
      const filePath = resolveAppImagePath(request.url);
      if (!filePath || !fs.existsSync(filePath)) {
        return new Response('not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      return new Response(String(err), { status: 500 });
    }
  });

  // Injeta Referer da página de origem nas requisições para domínios sinapi
  // (alguns servidores devolvem 404 sem o Referer correto).
  const ses = session.defaultSession;
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const u = details.url;
    if (RemoteImageResolver.shouldRewriteHeaders(u)) {
      const referer = RemoteImageResolver.refererFor(u);
      if (referer) {
        details.requestHeaders['Referer'] = referer;
        details.requestHeaders['User-Agent'] = details.requestHeaders['User-Agent'] || 'Mozilla/5.0';
      }
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (e) => {
  if (quittingAfterDrain) return;

  // Se não há nada em voo, terminar imediatamente.
  if (!hasPendingWork()) {
    if (xlsxWorker) {
      try { xlsxWorker.terminate(); } catch (_) { /* ignore */ }
      xlsxWorker = null;
    }
    return;
  }

  // Há save em andamento. Adiar shutdown até drenar (com timeout duro de 30s)
  // para evitar matar o worker no meio de um write e zerar o arquivo.
  e.preventDefault();
  const DRAIN_TIMEOUT_MS = 30_000;
  const start = Date.now();
  const tick = () => {
    const drained = !hasPendingWork();
    const expired = (Date.now() - start) > DRAIN_TIMEOUT_MS;
    if (drained || expired) {
      quittingAfterDrain = true;
      if (xlsxWorker) {
        try { xlsxWorker.terminate(); } catch (_) { /* ignore */ }
        xlsxWorker = null;
      }
      app.quit();
    } else {
      setTimeout(tick, 100);
    }
  };
  tick();
});

function registerIpcHandlers() {
  ipcMain.handle('dialog:openSpreadsheet', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar planilha',
      properties: ['openFile'],
      filters: [
        { name: 'Planilhas', extensions: ['xlsx', 'xlsm', 'xls', 'csv'] },
        { name: 'Todos', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const stat = fs.statSync(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
      modified: stat.mtimeMs,
    };
  });

  ipcMain.handle('xlsx:listSheets', async (_e, filePath) =>
    runWorkerJob('listSheets', { filePath }));

  ipcMain.handle('xlsx:listColumns', async (_e, args) =>
    runWorkerJob('listColumns', args));

  ipcMain.handle('xlsx:loadGroups', async (_e, args) =>
    runWorkerJob('loadGroups', args));

  ipcMain.handle('xlsx:saveStatuses', async (_e, args) => {
    if (!args || !args.filePath) throw new Error('filePath ausente para saveStatuses');
    return enqueueSave(args.filePath, args);
  });

  ipcMain.handle('image:resolve', (_e, absPath) => {
    if (!absPath) return null;
    const encoded = Buffer.from(absPath, 'utf8').toString('base64url');
    return `app-image://local/${encoded}`;
  });

  ipcMain.handle('image:resolveRemote', async (_e, url) => {
    return await RemoteImageResolver.resolve(url);
  });

  ipcMain.handle('app:platform', () => process.platform);
  ipcMain.handle('app:version', () => app.getVersion());

  // Abre uma URL no navegador padrão do sistema (usado pelo botão "Abrir no
  // mapa" do modal de metadados). Restrito a http(s) — nunca abrir file:/
  // outros esquemas a partir de dado externo.
  ipcMain.handle('shell:openExternal', async (_e, url) => {
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'Protocolo não permitido' };
      }
      await shell.openExternal(parsed.href);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('clipboard:writeText', (_e, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });

  // Renderer informa estado de gravação a cada mudança em dirty/saving.
  ipcMain.on('app:setRenderState', (_e, state) => {
    if (state && typeof state === 'object') {
      renderState = {
        dirty: !!state.dirty,
        saving: !!state.saving,
      };
    }
  });

  // Renderer reporta o resultado do save pedido por "Salvar e fechar".
  ipcMain.on('app:confirmCloseAfterSave', (_e, ok) => {
    pendingCloseAfterSave = false;
    if (ok && mainWindow) {
      forceClosing = true;
      mainWindow.close();
    } else if (mainWindow) {
      // Falhou: avisa o usuário e mantém aberta.
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        buttons: ['OK'],
        title: 'Falha ao salvar',
        message: 'Não foi possível gravar as alterações.',
        detail: 'A janela continuará aberta. Verifique se a planilha está acessível e tente novamente.',
      });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolver remoto: dada uma URL que retorna HTML com várias imagens, escolhe a
// "maior" (por Content-Length) e devolve sua URL final. Cacheia em memória.
// Adaptado pra páginas estilo Slick com <img class="zoom-image" src="...">.

const RemoteImageResolver = (() => {
  const cache = new Map();          // pageUrl -> { ok, url, size, candidates, ts }
  const inflight = new Map();       // pageUrl -> Promise
  const refererByImageHost = new Map(); // hostDaImagem -> URL da página que originou
  const TTL_MS = 30 * 60 * 1000;    // 30 min
  const FETCH_TIMEOUT = 15_000;
  const MAX_HTML_BYTES = 1_500_000; // 1.5 MB

  // Domínios cujo conteúdo precisa de Referer da página de origem.
  const NEEDS_REFERER = /(^|\.)sinapi\.com\.br$|(^|\.)service\d*\.sinapi\.com\.br$/i;

  function shouldRewriteHeaders(url) {
    try {
      const u = new URL(url);
      return NEEDS_REFERER.test(u.hostname);
    } catch { return false; }
  }
  function refererFor(url) {
    try {
      const u = new URL(url);
      return refererByImageHost.get(u.hostname) || null;
    } catch { return null; }
  }
  function rememberReferer(imageUrl, pageUrl) {
    try {
      const u = new URL(imageUrl);
      refererByImageHost.set(u.hostname, pageUrl);
    } catch { /* ignore */ }
  }

  async function resolve(pageUrl) {
    if (!pageUrl) return { ok: false, error: 'empty url' };
    const now = Date.now();
    const cached = cache.get(pageUrl);
    if (cached && (now - cached.ts) < TTL_MS) return cached;
    if (inflight.has(pageUrl)) return await inflight.get(pageUrl);

    const promise = (async () => {
      try {
        const html = await fetchText(pageUrl);
        const candidates = extractZoomImages(html);
        if (!candidates.length) {
          const fallback = extractFirstImg(html);
          if (fallback) {
            const result = { ok: true, url: fallback, size: 0, candidates: [fallback], ts: Date.now(), source: 'fallback' };
            rememberReferer(fallback, pageUrl);
            cache.set(pageUrl, result);
            return result;
          }
          throw new Error('Nenhuma imagem encontrada na página.');
        }
        for (const c of candidates) rememberReferer(c, pageUrl);
        const sized = await Promise.all(candidates.map(u => headSize(u, pageUrl).then(size => ({ url: u, size }))));
        sized.sort((a, b) => (b.size || 0) - (a.size || 0));
        const best = sized[0];
        const result = { ok: true, url: best.url, size: best.size, candidates: sized, ts: Date.now(), source: 'zoom-image' };
        cache.set(pageUrl, result);
        return result;
      } catch (err) {
        const result = { ok: false, error: err.message || String(err), ts: Date.now() };
        cache.set(pageUrl, result);
        return result;
      } finally {
        inflight.delete(pageUrl);
      }
    })();
    inflight.set(pageUrl, promise);
    return await promise;
  }

  function fetchText(url) {
    return new Promise((resolve, reject) => {
      let parsed;
      try { parsed = new URL(url); } catch (e) { return reject(e); }
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        host: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        timeout: FETCH_TIMEOUT,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*' },
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).href;
          return fetchText(next).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let buf = '';
        let total = 0;
        res.setEncoding('utf8');
        res.on('data', c => {
          total += c.length;
          if (total > MAX_HTML_BYTES) { res.destroy(); reject(new Error('HTML grande demais')); return; }
          buf += c;
        });
        res.on('end', () => resolve(buf));
        res.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', reject);
      req.end();
    });
  }

  function headSize(url, referer) {
    return new Promise((resolve) => {
      let parsed;
      try { parsed = new URL(url); } catch { return resolve(0); }
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        host: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'HEAD',
        timeout: FETCH_TIMEOUT,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': referer || '' },
      }, res => {
        const len = parseInt(res.headers['content-length'] || '0', 10) || 0;
        const ct = res.headers['content-type'] || '';
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300 && /image\//i.test(ct)) resolve(len);
        else resolve(0);
      });
      req.on('timeout', () => { req.destroy(); resolve(0); });
      req.on('error', () => resolve(0));
      req.end();
    });
  }

  function extractZoomImages(html) {
    const re = /<img[^>]*class\s*=\s*["'][^"']*\bzoom-image\b[^"']*["'][^>]*src\s*=\s*["']([^"']+)["']/gi;
    const re2 = /<img[^>]*src\s*=\s*["']([^"']+)["'][^>]*class\s*=\s*["'][^"']*\bzoom-image\b[^"']*["']/gi;
    const out = new Set();
    let m;
    while ((m = re.exec(html)))  out.add(m[1]);
    while ((m = re2.exec(html))) out.add(m[1]);
    return [...out];
  }
  function extractFirstImg(html) {
    const re = /<img[^>]*src\s*=\s*["']([^"']+)["']/i;
    const m = html.match(re);
    return m ? m[1] : null;
  }
  function clear() { cache.clear(); inflight.clear(); }

  return { resolve, shouldRewriteHeaders, refererFor, rememberReferer, clear };
})();
