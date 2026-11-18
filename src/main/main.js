const { app, BrowserWindow, clipboard, ipcMain, Menu, session, shell, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const settingsStore = require('./env');
const { loadEnv, loadSettingsFile, ensureSettingsFile, saveSetting } = settingsStore;

const ROOT = path.join(__dirname, '..', '..');
// Settings leave the environment before any window or helper process exists, so the key
// is never inherited by the processes that run web pages.
settingsStore.captureEnvironment();
// Developers keep the key in .env; the packaged app uses the settings file instead.
// COMPANION_SKIP_DOTENV=1 ignores .env, to try the first-run experience from source.
if (!app.isPackaged && !process.env.COMPANION_SKIP_DOTENV) loadEnv(ROOT);
// Lets tests and demos run with a throwaway profile instead of the real one.
if (process.env.COMPANION_USER_DATA) app.setPath('userData', path.resolve(process.env.COMPANION_USER_DATA));
// People using the packaged app keep their key in a settings file in the app's data folder.
const settingsFile = () => path.join(app.getPath('userData'), 'settings.txt');
loadSettingsFile(settingsFile());

const { resolveModel, streamAnswer, checkKey, hasImages, settings: inferenceSettings, PAGE_CHAR_BUDGET } = require('./inference');
const { registerPdfScheme, showPdfsInViewer, pdfAddress, pdfText, closeWorkers } = require('./pdf');

registerPdfScheme(); // has to happen before the app is ready

const PAGE_PRELOAD = path.join(ROOT, 'src', 'page', 'page-preload.js');
const SHELL_PRELOAD = path.join(ROOT, 'src', 'shell', 'shell-preload.js');
const PARTITION = 'persist:reader';
const TOKEN_FACTORY_URL = 'https://tokenfactory.nebius.com/';

let win = null;
let modelInfo = null;
const running = new Map(); // ask id -> AbortController

// ---------- small JSON settings store (mascot choice, recent pages) ----------
const storeFile = () => path.join(app.getPath('userData'), 'settings.json');
function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
  } catch {
    return {};
  }
}
function writeStore(patch) {
  const next = { ...readStore(), ...patch };
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(storeFile(), JSON.stringify(next, null, 2));
  } catch (err) {
    console.error('Could not save settings:', err.message);
  }
  return next;
}

const isWebUrl = (value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

function startUrl() {
  const fromArg = process.argv.slice(1).find((arg) => /^https?:\/\//i.test(arg));
  const value = fromArg || settingsStore.get('START_URL');
  return isWebUrl(value) ? value : '';
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#E6F5EC',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // On Windows and Linux the menu stays out of the way; Alt shows it and its shortcuts still work.
    autoHideMenuBar: process.platform !== 'darwin',
    trafficLightPosition: { x: 16, y: 12 },
    show: false,
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(ROOT, 'src', 'shell', 'index.html'));
  win.on('closed', () => {
    win = null;
    closeWorkers();
  });

  // The shell itself never navigates anywhere.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Lock down every <webview> the shell creates: our preload only, no Node, isolated.
  win.webContents.on('will-attach-webview', (_event, prefs, params) => {
    prefs.preload = PAGE_PRELOAD;
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.webSecurity = true;
    delete prefs.preloadURL;
    params.partition = PARTITION;
    if (params.src && !isWebUrl(params.src)) params.src = 'about:blank';
  });
}

function configureReaderSession() {
  const reader = session.fromPartition(PARTITION);
  // Present as a regular Chrome so sites serve their normal pages.
  // Keep only the tokens a stock Chrome sends; that drops "Electron/x" and the app's own
  // name token whichever way Chromium spells it.
  const ua = reader
    .getUserAgent()
    .replace(/\s(?!(?:Mozilla|AppleWebKit|Chrome|Safari)\/)[^\s/()]+\/[^\s()]+(?=\s|$)/g, '');
  reader.setUserAgent(ua);
  // A reading tool needs no camera, location or notifications. Fullscreen video is fine.
  reader.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
  reader.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
  reader.on('will-download', (event) => event.preventDefault());
  // PDFs open in the app's own viewer, where their text can be highlighted and explained.
  showPdfsInViewer(reader, (id) => {
    const tab = webContents.fromId(Number(id));
    return tab && tab.getType() === 'webview' && win && !win.isDestroyed() && tab.hostWebContents === win.webContents ? tab : null;
  });
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  // Links that want a new window open in a new tab instead. The app window decides
  // whether to honour it (only for the tab on screen, and not in bursts).
  contents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url) && win && !win.isDestroyed()) win.webContents.send('open-tab', url, contents.id);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault();
  });
  // A page may not hold the reader on it with a "leave this page?" trap: that would leave
  // the old page on screen under the address the reader just typed.
  contents.on('will-prevent-unload', (event) => event.preventDefault());
});

// Never hand a client certificate to a site without the reader choosing one.
app.on('select-client-certificate', (event, _contents, _url, _list, callback) => {
  event.preventDefault();
  callback();
});

async function openSettingsFile() {
  const failure = await shell.openPath(ensureSettingsFile(settingsFile()));
  if (failure) shell.showItemInFolder(settingsFile());
}

function sendCommand(name) {
  if (win && !win.isDestroyed()) win.webContents.send('command', name);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => sendCommand('new-tab') },
        { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: () => sendCommand('close-tab') },
        { type: 'separator' },
        { label: 'Open location', accelerator: 'CmdOrCtrl+L', click: () => sendCommand('focus-url') },
        { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => sendCommand('home') },
        { type: 'separator' },
        { label: 'Open settings file', accelerator: 'CmdOrCtrl+,', click: () => openSettingsFile() },
        { type: 'separator' },
        isMac ? { label: 'Close window', accelerator: 'CmdOrCtrl+Shift+W', role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => sendCommand('back') },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => sendCommand('forward') },
        { label: 'Reload page', accelerator: 'CmdOrCtrl+R', click: () => sendCommand('reload') },
        { type: 'separator' },
        { label: 'Zoom in', accelerator: 'CmdOrCtrl+=', click: () => sendCommand('zoom-in') },
        { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => sendCommand('zoom-out') },
        { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => sendCommand('zoom-reset') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ label: 'Developer tools (app)', accelerator: 'Alt+CmdOrCtrl+I', click: () => win?.webContents.openDevTools({ mode: 'detach' }) }]),
      ],
    },
    {
      label: 'Companion',
      submenu: [
        { label: 'Explain highlight', accelerator: 'CmdOrCtrl+E', click: () => sendCommand('explain') },
        { label: 'Snip a region', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('snip') },
        { label: 'Ask about this page', accelerator: 'CmdOrCtrl+J', click: () => sendCommand('ask-page') },
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        { label: 'Next tab', accelerator: 'Ctrl+Tab', click: () => sendCommand('next-tab') },
        { label: 'Previous tab', accelerator: 'Ctrl+Shift+Tab', click: () => sendCommand('prev-tab') },
        { type: 'separator' },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ label: `Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, click: () => sendCommand(`tab-${n}`) })),
        { label: 'Last tab', accelerator: 'CmdOrCtrl+9', click: () => sendCommand('tab-9') },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
// Only the app's own window may call these. A web page's process has no business here,
// even if it found a way to send a message.
const fromApp = (event) => Boolean(win) && !win.isDestroyed() && event.sender === win.webContents;
const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
  if (!fromApp(event)) throw new Error('Not allowed');
  return fn(event, ...args);
});

// Questions cost money, so they are paced: a few at once at most, and not in rapid fire.
const MAX_RUNNING = 3;
const MIN_GAP_MS = 350;
let lastAskAt = 0;

function registerIpc() {
  handle('config:get', async () => {
    loadSettingsFile(settingsFile()); // pick up edits made since the last check
    modelInfo = await resolveModel();
    const store = readStore();
    return {
      model: modelInfo,
      startUrl: startUrl(),
      mascot: settingsStore.get('COMPANION_MASCOT') || store.mascot || '',
      mascotName: settingsStore.get('COMPANION_NAME').trim().slice(0, 24),
      recent: Array.isArray(store.recent) ? store.recent : [],
      tokenFactoryUrl: TOKEN_FACTORY_URL,
      platform: process.platform,
    };
  });

  handle('settings:set', (_event, patch) => {
    const clean = {};
    if (typeof patch?.mascot === 'string') clean.mascot = patch.mascot.slice(0, 32);
    if (Array.isArray(patch?.recent)) {
      clean.recent = patch.recent
        .filter((item) => item && isWebUrl(item.url))
        .slice(0, 8)
        .map((item) => ({ url: item.url, title: String(item.title || '').slice(0, 140) }));
    }
    writeStore(clean);
    return true;
  });

  handle('settings:open', () => openSettingsFile());

  // "Use the key I copied": the key goes clipboard -> this process -> settings file.
  // It is never sent to the app window; the window only learns whether it worked.
  handle('key:from-clipboard', async () => {
    const copied = clipboard.readText().trim();
    if (!copied) return { ok: false, reason: 'empty' };
    // Only something shaped like a Token Factory key ("v1." then two long runs of
    // letters, digits, - and _) is accepted. Another service's token, a password or a
    // sentence is refused here, before it is sent anywhere.
    if (!/^v\d+\.[A-Za-z0-9_-]{40,400}\.[A-Za-z0-9_-]{40,400}$/.test(copied)) return { ok: false, reason: 'not-a-key' };
    const verdict = await checkKey(copied);
    if (verdict !== 'ok') return { ok: false, reason: verdict };
    saveSetting(settingsFile(), 'NEBIUS_API_KEY', copied);
    clipboard.clear(); // the key has a home now; do not leave it lying on the clipboard
    modelInfo = null;
    return { ok: true };
  });

  // The "Powered by" mark opens Token Factory in the default browser, so the page being read stays put.
  handle('open-token-factory', () => shell.openExternal(TOKEN_FACTORY_URL));

  // Screenshot of a region of the page being read (page pixels only, never the app's own overlay).
  handle('capture', async (_event, { webContentsId, rect }) => {
    const target = webContents.fromId(Number(webContentsId));
    if (!target || target.getType() !== 'webview') throw new Error('No page to capture');
    const area = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(8, Math.round(rect.width)),
      height: Math.max(8, Math.round(rect.height)),
    };
    let image = await target.capturePage(area);
    const size = image.getSize();
    const longest = Math.max(size.width, size.height);
    if (longest > 1600) {
      const scale = 1600 / longest;
      image = image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale), quality: 'best' });
    }
    return `data:image/jpeg;base64,${image.toJPEG(88).toString('base64')}`;
  });

  // Text of the PDF a tab is showing. The window names the tab; the address comes from the
  // tab itself, so nothing here can be pointed at an address the reader did not open.
  handle('pdf:text', async (_event, { webContentsId }) => {
    const target = webContents.fromId(Number(webContentsId));
    if (!target || target.getType() !== 'webview' || target.hostWebContents !== win.webContents) return { ok: false, reason: 'unreadable' };
    const url = pdfAddress(target.getURL()); // the PDF itself, when the tab shows it in the app's viewer
    if (!isWebUrl(url)) return { ok: false, reason: 'unreadable' };
    return pdfText(session.fromPartition(PARTITION), url, PAGE_CHAR_BUDGET);
  });

  ipcMain.on('ask:start', async (event, request) => {
    if (!fromApp(event)) return;
    const id = String(request?.id || '');
    if (!id) return;
    const reply = (type, data = {}) => {
      if (!event.sender.isDestroyed()) event.sender.send('ask:event', { id, type, ...data });
    };
    if (running.size >= MAX_RUNNING || Date.now() - lastAskAt < MIN_GAP_MS) {
      reply('error', { message: 'That was too many questions at once. Give it a second and ask again.' });
      return;
    }
    lastAskAt = Date.now();
    const controller = new AbortController();
    running.set(id, controller);
    try {
      // Pick up a model or key changed in the settings file since the last question.
      loadSettingsFile(settingsFile());
      if (!modelInfo?.ok || modelInfo.id !== inferenceSettings().model) modelInfo = await resolveModel();
      if (hasImages(request) && modelInfo.ok && !modelInfo.vision) {
        throw new Error(`${modelInfo.name} cannot read images. Set NEBIUS_MODEL in the settings file to a model with image input to ask about pictures.`);
      }
      // Tell the note which model this question is going to, then which one actually answered.
      const named = (modelId) => ({ modelId, name: modelId === modelInfo.id ? modelInfo.name : modelId.split('/').pop() });
      reply('model', named(modelInfo.id));
      const result = await streamAnswer(
        { ...request, reasoning: modelInfo.reasoning },
        {
          signal: controller.signal,
          onReasoning: () => reply('thinking'),
          onDelta: (text) => reply('delta', { text }),
          onModel: (modelId) => reply('model', named(modelId)),
        },
      );
      if (result.aborted) reply('aborted');
      else reply('done', { finishReason: result.finishReason });
    } catch (err) {
      reply('error', { message: String(err?.message || err), code: err?.code || '' });
    } finally {
      running.delete(id);
    }
  });

  ipcMain.on('ask:cancel', (event, id) => {
    if (fromApp(event)) running.get(String(id))?.abort();
  });
}

app.whenReady().then(() => {
  configureReaderSession();
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
