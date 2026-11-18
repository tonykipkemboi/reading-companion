// PDFs. Chromium's built-in PDF viewer keeps a document's text and selections to itself,
// so the companion could neither read a PDF nor see what the reader highlighted in one.
// Instead, a PDF that a tab opens is shown by the app's own viewer page (src/pdf/viewer.*),
// built on pdf.js, where the text is ordinary selectable page text.
//
// Three pieces live here:
//   1. spotting a PDF as a tab navigates to it and sending the tab to the viewer instead,
//   2. the "reader-pdf:" address the viewer page and the document bytes are served from,
//   3. reading a PDF's full text for "ask about this page".
//
// A PDF is untrusted. It is only ever parsed inside sandboxed page processes (the tab
// showing it, or a hidden window with no network access), never in this process.
const { BrowserWindow, protocol, session } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const PDF_DIR = path.join(ROOT, 'src', 'pdf');
const LIB_DIR = path.join(ROOT, 'node_modules', 'pdfjs-dist');
const SCHEME = 'reader-pdf';
const VIEWER = `${SCHEME}://viewer`;
const EXTRACT_PAGE = path.join(PDF_DIR, 'extract.html');
const EXTRACT_PRELOAD = path.join(PDF_DIR, 'extract-preload.js');
const EXTRACT_PARTITION = 'pdf-extract'; // in memory only
const MAX_BYTES = 60 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30000;
const READ_TIMEOUT_MS = 30000;

// ---------- downloading ----------
const bytes = new Map(); // address -> { at, data }; a few recent PDFs, so one download serves the viewer and the text reader
const downloading = new Map(); // address -> Promise

async function download(readerSession, url) {
  const response = await readerSession.fetch(url, { credentials: 'include', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) return { reason: 'unreachable' };
  if (Number(response.headers.get('content-length')) > MAX_BYTES) return { reason: 'too-large' };
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) return { reason: 'too-large' };
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (!data.subarray(0, 1024).includes('%PDF-')) return { reason: 'not-a-pdf' };
  return { data };
}

// Returns { data } or { reason }: unreachable, too-large, not-a-pdf.
async function pdfBytes(readerSession, url) {
  const hit = bytes.get(url);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return { data: hit.data };
  if (downloading.has(url)) return downloading.get(url);
  const job = (async () => {
    try {
      const got = await download(readerSession, url);
      if (got.data) {
        bytes.delete(url);
        bytes.set(url, { at: Date.now(), data: got.data });
        let total = 0;
        for (const entry of bytes.values()) total += entry.data.length;
        while (bytes.size > 3 || (total > 2 * MAX_BYTES && bytes.size > 1)) {
          const oldest = bytes.keys().next().value;
          total -= bytes.get(oldest).data.length;
          bytes.delete(oldest);
        }
      }
      return got;
    } catch {
      return { reason: 'unreachable' };
    }
  })();
  downloading.set(url, job);
  try {
    return await job;
  } finally {
    downloading.delete(url);
  }
}

// ---------- the viewer's address ----------
const docs = new Map(); // id -> address of the PDF; ids are unguessable, so a web page cannot ask for a document
const bypass = new Set(); // addresses the viewer could not show; Chromium's own viewer gets the next try

// Must run before the app is ready.
function registerPdfScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}

function viewerUrl(url) {
  const id = crypto.randomBytes(16).toString('hex');
  docs.set(id, url);
  while (docs.size > 200) docs.delete(docs.keys().next().value);
  return `${VIEWER}/index.html?id=${id}&src=${encodeURIComponent(url)}`;
}

// The address of the PDF behind a viewer address; any other address comes back unchanged.
function pdfAddress(url) {
  if (!String(url).startsWith(`${VIEWER}/`)) return url;
  try {
    return docs.get(new URL(url).searchParams.get('id')) || '';
  } catch {
    return '';
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
};
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const GUARD = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'cross-origin-resource-policy': 'same-origin', 'cache-control': 'no-store' };
const plain = (status) => new Response('', { status, headers: GUARD });

// The viewer's own files, and the parts of pdf.js it loads. Nothing else on disk is reachable.
const OWN = { '/index.html': 'viewer.html', '/viewer.js': 'viewer.js', '/viewer.css': 'viewer.css' };
const LIB = /^\/lib\/(build\/pdf(\.worker)?\.min\.mjs|web\/pdf_viewer\.(mjs|css)|(cmaps|standard_fonts|wasm|iccs)\/[\w.-]+)$/;

async function sendFile(file) {
  try {
    const body = await fs.promises.readFile(file);
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    return new Response(body, { headers: { ...GUARD, 'content-type': type, ...(type.startsWith('text/html') ? { 'content-security-policy': CSP } : {}) } });
  } catch {
    return plain(404);
  }
}

function serveViewer(readerSession) {
  readerSession.protocol.handle(SCHEME, async (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return plain(400);
    }
    if (url.host !== 'viewer' || request.method !== 'GET') return plain(404);
    const route = url.pathname;
    if (OWN[route]) return sendFile(path.join(PDF_DIR, OWN[route]));
    if (LIB.test(route)) return sendFile(path.join(LIB_DIR, route.slice('/lib/'.length)));
    const address = docs.get(url.searchParams.get('id') || '');
    if (!address) return plain(404);
    if (route === '/doc') {
      const got = await pdfBytes(readerSession, address);
      if (!got.data) return new Response(got.reason, { status: 502, headers: GUARD });
      return new Response(got.data, { headers: { ...GUARD, 'content-type': 'application/pdf' } });
    }
    if (route === '/fallback') {
      bypass.add(address);
      return plain(204);
    }
    return plain(404);
  });
}

const isPdfResponse = (headers) => {
  const name = Object.keys(headers || {}).find((key) => key.toLowerCase() === 'content-type');
  return /^application\/(x-)?pdf\b/i.test(String(headers?.[name]?.[0] || ''));
};

// When a tab's main page turns out to be a PDF, the load is stopped at the headers and
// the tab is sent to the viewer, which fetches the same address itself. `tabFor` returns
// the tab for a web contents id, or nothing if it is not one of the app's own tabs.
function showPdfsInViewer(readerSession, tabFor) {
  serveViewer(readerSession);
  readerSession.webRequest.onHeadersReceived((details, callback) => {
    try {
      const wanted = details.resourceType === 'mainFrame' && details.method === 'GET' && details.statusCode === 200
        && /^https?:\/\//i.test(details.url) && isPdfResponse(details.responseHeaders);
      const tab = wanted && !bypass.delete(details.url) ? tabFor(details.webContentsId) : null;
      if (tab) {
        callback({ cancel: true });
        setImmediate(() => {
          if (!tab.isDestroyed()) tab.loadURL(viewerUrl(details.url)).catch(() => {});
        });
        return;
      }
    } catch { /* fall through and let the page load as usual */ }
    callback({});
  });
}

// ---------- reading the text ----------
const texts = new Map(); // address -> { at, result }
const reading = new Map(); // address -> Promise
const workers = new Set();
let sessionReady = false;

function extractSession() {
  const ses = session.fromPartition(EXTRACT_PARTITION);
  if (sessionReady) return ses;
  sessionReady = true;
  // The window may load the app's own files and nothing else.
  const appFiles = pathToFileURL(ROOT).href.replace(/\/?$/, '/');
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(appFiles) }));
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
  return ses;
}

// Hands the bytes to a hidden window that is sandboxed and offline; only text comes back.
function readText(data, limit) {
  return new Promise((resolve) => {
    const worker = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: EXTRACT_PRELOAD,
        session: extractSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        images: false,
        webgl: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    workers.add(worker);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      workers.delete(worker);
      if (!worker.isDestroyed()) worker.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'unreadable' }), READ_TIMEOUT_MS);
    const contents = worker.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('render-process-gone', () => finish({ ok: false, reason: 'unreadable' }));
    contents.on('did-fail-load', () => finish({ ok: false, reason: 'unreadable' }));
    contents.ipc.once('pdf:ready', () => contents.send('pdf:job', { data: new Uint8Array(data), limit }));
    contents.ipc.once('pdf:done', (_event, result) => finish(result));
    worker.loadFile(EXTRACT_PAGE);
  });
}

// What came back is only trusted as far as its shape: plain strings and whole numbers.
function clean(result, limit) {
  if (!result?.ok) return { ok: false, reason: result?.reason === 'locked' ? 'locked' : 'unreadable' };
  const text = String(result.text || '').slice(0, limit);
  const pages = Math.max(0, Math.min(100000, Math.trunc(Number(result.pages)) || 0));
  const pagesRead = Math.max(0, Math.min(pages, Math.trunc(Number(result.pagesRead)) || 0));
  if (!text.trim()) return { ok: false, reason: 'no-text', pages };
  return { ok: true, text, title: String(result.title || '').slice(0, 300), pages, pagesRead };
}

// Returns { ok, text, title, pages, pagesRead } or { ok: false, reason }.
// Reasons: unreachable, too-large, not-a-pdf, locked, no-text, unreadable.
async function pdfText(readerSession, url, limit) {
  const hit = texts.get(url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.result;
  if (reading.has(url)) return reading.get(url);
  const job = (async () => {
    const got = await pdfBytes(readerSession, url);
    const result = got.data ? clean(await readText(got.data, limit), limit) : { ok: false, reason: got.reason };
    // A failed download may work on the next try; anything else is the same next time.
    if (result.reason !== 'unreachable') {
      texts.set(url, { at: Date.now(), result });
      while (texts.size > 4) texts.delete(texts.keys().next().value);
    }
    return result;
  })();
  reading.set(url, job);
  try {
    return await job;
  } finally {
    reading.delete(url);
  }
}

// The hidden windows must not keep the app alive once its real window is gone.
function closeWorkers() {
  for (const worker of workers) if (!worker.isDestroyed()) worker.destroy();
  workers.clear();
}

module.exports = { registerPdfScheme, showPdfsInViewer, pdfAddress, pdfText, closeWorkers };
