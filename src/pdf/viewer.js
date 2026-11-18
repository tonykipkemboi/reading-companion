// The app's own PDF page view, shown in a tab in place of Chromium's built-in viewer.
// pdf.js draws each page on a canvas and lays the page's real text over it, so the reader
// can highlight a passage and the companion can see it, exactly as on a web page.
//
// The page scrolls as one ordinary document. A page's text layer is kept once built, so
// a highlight with a note on it survives scrolling far away and back; only the drawn
// canvases are let go when a page is well off screen.
import * as pdfjsLib from './lib/build/pdf.min.mjs';

globalThis.pdfjsLib = pdfjsLib; // the viewer components look for the library here
const { TextLayerBuilder } = await import('./lib/web/pdf_viewer.mjs');

const lib = (file) => new URL(`lib/${file}`, location.href).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = lib('build/pdf.worker.min.mjs');

const params = new URLSearchParams(location.search);
const id = params.get('id') || '';
const source = params.get('src') || '';
const pagesEl = document.querySelector('#pages');
const statusEl = document.querySelector('#status');
const countEl = document.querySelector('#count');

const MAX_PAGE_WIDTH = 960; // CSS pixels; wide enough to read, narrow enough to leave room for notes
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
const KEEP_DRAWN = '1600px 0px'; // pages within this distance of the screen stay drawn

// If this viewer cannot show the file (password-protected, damaged, download refused),
// the tab goes back to the address itself and Chromium's own viewer gets a try.
async function giveUp() {
  try {
    await fetch(`fallback?id=${encodeURIComponent(id)}`);
  } catch { /* the tab navigates away either way */ }
  if (/^https?:\/\//i.test(source)) location.replace(source);
  else statusEl.textContent = 'This PDF could not be opened.';
}

async function open() {
  if (window.top !== window) return null; // never inside another page's frame
  const response = await fetch(`doc?id=${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  const data = new Uint8Array(await response.arrayBuffer());
  return pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    enableXfa: false,
    cMapUrl: lib('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: lib('standard_fonts/'),
    wasmUrl: lib('wasm/'),
    iccUrl: lib('iccs/'),
    verbosity: 0,
  }).promise;
}

let doc = null;
try {
  doc = await open();
} catch { /* handled below */ }

if (!doc) {
  await giveUp();
} else {
  const fileName = (() => {
    try {
      return decodeURIComponent(new URL(source).pathname.split('/').pop() || '');
    } catch {
      return '';
    }
  })();
  document.title = fileName || 'PDF';
  doc.getMetadata().then((meta) => {
    const title = String(meta?.info?.Title || '').trim();
    if (title.length > 3) document.title = title.slice(0, 200);
  }).catch(() => {});

  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const fitScale = () => Math.max(0.5, Math.min(MAX_PAGE_WIDTH, window.innerWidth - 56) / base.width);
  let scale = fitScale();
  pagesEl.style.setProperty('--scale-factor', scale);

  // One entry per page: its element, and once it has been on screen, its pdf.js page,
  // text layer and drawn canvas.
  const views = Array.from({ length: doc.numPages }, (_, index) => {
    const div = document.createElement('div');
    div.className = 'page';
    div.dataset.pageNumber = String(index + 1);
    div.setAttribute('aria-label', `Page ${index + 1}`);
    const wrap = document.createElement('div');
    wrap.className = 'canvasWrapper';
    div.append(wrap);
    pagesEl.append(div);
    return { number: index + 1, div, wrap, page: index === 0 ? first : null, width: base.width, height: base.height, near: false, drawn: '', busy: false, task: null, text: null };
  });
  const size = (view) => {
    view.div.style.width = `${Math.floor(view.width * scale)}px`;
    view.div.style.height = `${Math.floor(view.height * scale)}px`;
  };
  views.forEach(size);
  statusEl.remove();

  async function draw(view) {
    const wanted = () => `${scale}:${window.devicePixelRatio}`;
    if (!view.near || view.drawn === wanted() || view.busy) return;
    view.busy = true;
    let stamp = '';
    try {
      if (!view.page) {
        view.page = await doc.getPage(view.number);
        const own = view.page.getViewport({ scale: 1 });
        if (own.width !== view.width || own.height !== view.height) {
          view.width = own.width;
          view.height = own.height;
          size(view);
        }
      }
      stamp = wanted();
      const viewport = view.page.getViewport({ scale });
      let ratio = window.devicePixelRatio || 1;
      const pixels = viewport.width * viewport.height * ratio * ratio;
      if (pixels > MAX_CANVAS_PIXELS) ratio *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      view.task = view.page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
      await view.task.promise;
      if (!view.near) {
        // The page was scrolled far away while it was being drawn: do not keep the drawing.
        canvas.width = 0;
        canvas.height = 0;
        throw new Error('no longer near');
      }
      view.wrap.replaceChildren(canvas);
      view.drawn = stamp;
      if (!view.text) {
        view.text = new TextLayerBuilder({ pdfPage: view.page });
        view.div.append(view.text.div);
      }
      await view.text.render({ viewport });
    } catch {
      stamp = ''; // a cancelled or failed page stays blank; the rest of the document still reads
    } finally {
      view.task = null;
      view.busy = false;
    }
    if (!view.near) {
      if (view.drawn) release(view);
      return;
    }
    // The window may have been resized or zoomed while this page was being drawn.
    if (stamp && stamp !== wanted()) draw(view);
  }

  function release(view) {
    view.task?.cancel();
    for (const canvas of view.wrap.querySelectorAll('canvas')) {
      canvas.width = 0;
      canvas.height = 0;
    }
    view.wrap.replaceChildren();
    view.drawn = '';
  }

  const byElement = new Map(views.map((view) => [view.div, view]));
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const view = byElement.get(entry.target);
      view.near = entry.isIntersecting;
      if (view.near) draw(view);
      else if (view.drawn) release(view);
    }
  }, { rootMargin: KEEP_DRAWN });
  views.forEach((view) => watcher.observe(view.div));

  // Page counter.
  let counting = false;
  const count = () => {
    counting = false;
    const middle = window.innerHeight / 2;
    let current = 1;
    for (const view of views) {
      if (view.div.getBoundingClientRect().top <= middle) current = view.number;
      else break;
    }
    countEl.textContent = `${current} / ${views.length}`;
    countEl.hidden = false;
  };
  const scheduleCount = () => {
    if (counting) return;
    counting = true;
    requestAnimationFrame(count);
  };
  window.addEventListener('scroll', scheduleCount, { passive: true });
  count();

  // Resizing the window or zooming changes how wide a page can be and how sharp it must
  // be drawn. The text layers follow the scale on their own; the canvases are redrawn.
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const next = fitScale();
      const scroller = document.scrollingElement;
      const progress = scroller.scrollHeight > 0 ? scroller.scrollTop / scroller.scrollHeight : 0;
      if (next !== scale) {
        scale = next;
        pagesEl.style.setProperty('--scale-factor', scale);
        views.forEach(size);
        scroller.scrollTop = progress * scroller.scrollHeight;
      }
      views.forEach((view) => {
        if (view.near) draw(view);
      });
      scheduleCount();
    }, 160);
  });
}
