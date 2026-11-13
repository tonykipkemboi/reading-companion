// Runs inside every page the reader opens. It reports what the reader highlights, keeps
// track of where pinned highlights and snipped regions sit as the page scrolls, and hands
// the page text to the app on request. It never changes the page's own content.
const { ipcRenderer } = require('electron');

const CHANNEL = 'rc';
const HIGHLIGHT_NAME = 'rc-pin'; // the passage whose bubble is open
const PAST_NAME = 'rc-past'; // passages with a kept note
const toHost = (type, data = {}) => ipcRenderer.sendToHost(CHANNEL, { type, ...data });

const anchors = new Map(); // id -> { kind: 'range', range } | { kind: 'rect', x, y, width, height } (document coords)
let liveSignature = '';
let lastFrame = '';
let looping = false;
let picked = null; // the element last Option-clicked, so its outline can follow layout shifts
let hovered = null; // picture, chart or video under the pointer
let lastHovered = null;

const rectOf = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
const clean = (text, max) => String(text || '').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, max);

function liveSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const text = clean(sel.toString(), 6000);
  if (text.length < 2) return null;
  const range = sel.getRangeAt(0);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
  if (!rects.length) return null;
  return { sel, range, text, rects };
}

const BLOCKS = 'p,li,blockquote,pre,td,th,dd,dt,figcaption,h1,h2,h3,h4,h5,h6,section,article,div';
function surroundingText(range) {
  let node = range.commonAncestorContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  let block = node?.closest?.(BLOCKS) || node;
  // Climb until there is enough text to give the model real context.
  while (block && block.parentElement && block !== document.body && (block.innerText || '').length < 500) {
    block = block.parentElement;
  }
  return clean(block?.innerText, 3000);
}

function reportSelection() {
  const live = liveSelection();
  if (!live) {
    if (liveSignature) {
      liveSignature = '';
      toHost('selection-cleared');
    }
    return;
  }
  const bounds = live.range.getBoundingClientRect();
  const last = live.rects[live.rects.length - 1];
  const signature = `${live.text.length}:${live.text.slice(0, 40)}:${Math.round(bounds.top)}:${Math.round(bounds.left)}:${Math.round(last.right)}`;
  if (signature === liveSignature) return;
  liveSignature = signature;
  toHost('selection', {
    text: live.text,
    context: surroundingText(live.range),
    rect: rectOf(bounds),
    end: rectOf(last),
  });
  startLoop();
}

let selectionTimer = 0;
document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(reportSelection, 140);
});
// The page shares these DOM events with this script and can fabricate its own. Only
// events that came from the reader's real mouse and keyboard (isTrusted) may make the app
// do anything; a page must never be able to start a question on the reader's behalf.
const real = (handler) => (event) => {
  if (event.isTrusted) handler(event);
};

document.addEventListener('mouseup', real(() => setTimeout(reportSelection, 10)), true);
document.addEventListener('keyup', real((event) => {
  if (event.shiftKey || event.key === 'Shift') setTimeout(reportSelection, 10);
}), true);
document.addEventListener('mousedown', real(() => toHost('pointerdown')), true);
document.addEventListener('keydown', real((event) => {
  if (event.key === 'Escape') toHost('escape');
}), true);

// Option/Alt-click on a picture, chart or video snips exactly that element.
const VISUALS = 'img,picture,svg,canvas,video,figure';

// Pictures big enough to be worth asking about get an "Explain picture" button while hovered.
function visualAt(node) {
  const target = node?.closest?.(VISUALS);
  if (!target) return null;
  const r = target.getBoundingClientRect();
  return r.width >= 140 && r.height >= 90 ? target : null;
}
function setHovered(next) {
  if (next === hovered) return;
  hovered = next;
  if (next) {
    lastHovered = next;
    startLoop();
  } else {
    toHost('hover-end');
  }
}
document.addEventListener('mouseover', real((event) => setHovered(visualAt(event.target))), true);
// The pointer left the page altogether (for example onto the app's own button).
document.addEventListener('mouseout', real((event) => {
  if (!event.relatedTarget) setHovered(null);
}), true);

// A click on a passage or picture that has a kept note reopens that note.
const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
document.addEventListener('click', (event) => {
  if (!event.isTrusted) return;
  if (event.altKey || event.target?.closest?.('a,button,input,textarea,select')) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;
  for (const [id, anchor] of anchors) {
    if (!anchor.past) continue;
    let hit = false;
    if (anchor.kind === 'range') hit = Array.from(anchor.range.getClientRects()).some((r) => inside(r, event.clientX, event.clientY));
    else {
      const r = anchorRect(anchor);
      hit = Boolean(r) && inside({ left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height }, event.clientX, event.clientY);
    }
    if (hit) {
      toHost('anchor-click', { id });
      return;
    }
  }
}, true);

document.addEventListener('click', (event) => {
  if (!event.isTrusted || !event.altKey) return;
  const target = event.target?.closest?.(VISUALS);
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  picked = target;
  toHost('pick', { rect: rectOf(target.getBoundingClientRect()) });
}, true);

// ---------- pinned highlight ----------
function highlightGroup(name) {
  if (typeof Highlight === 'undefined' || !CSS.highlights) return null;
  let hl = CSS.highlights.get(name);
  if (!hl) {
    hl = new Highlight();
    CSS.highlights.set(name, hl);
  }
  return hl;
}
const pinnedHighlight = () => highlightGroup(HIGHLIGHT_NAME);

// Marks an anchor as the open one (strong highlight) or a kept note (soft highlight).
function setPast(id, past, scroll) {
  const anchor = anchors.get(id);
  if (!anchor) return;
  anchor.past = past;
  if (anchor.kind === 'range') {
    highlightGroup(past ? HIGHLIGHT_NAME : PAST_NAME)?.delete(anchor.range);
    highlightGroup(past ? PAST_NAME : HIGHLIGHT_NAME)?.add(anchor.range);
  }
  if (scroll) {
    const r = anchorRect(anchor);
    if (r && (r.y < 70 || r.y + r.height > window.innerHeight - 260)) {
      window.scrollBy({ top: r.y - window.innerHeight * 0.28, behavior: 'smooth' });
    }
  }
  startLoop();
}

function pin(id) {
  const live = liveSelection();
  if (!live) return false;
  const range = live.range.cloneRange();
  anchors.set(id, { kind: 'range', range });
  const hl = pinnedHighlight();
  if (hl) {
    hl.add(range);
    live.sel.removeAllRanges(); // the app highlight takes over from the native selection
    liveSignature = '';
  }
  startLoop();
  return true;
}

function unpin(id) {
  const anchor = anchors.get(id);
  if (anchor?.kind === 'range') {
    CSS.highlights?.get(HIGHLIGHT_NAME)?.delete(anchor.range);
    CSS.highlights?.get(PAST_NAME)?.delete(anchor.range);
  }
  anchors.delete(id);
}

// ---------- snipped region ----------
function describeRegion(rect) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  const inside = (el) => {
    const r = el.getBoundingClientRect();
    return r.right > rect.x && r.left < rect.x + rect.width && r.bottom > rect.y && r.top < rect.y + rect.height;
  };
  const alts = Array.from(document.querySelectorAll('img[alt],svg[aria-label],[role="img"][aria-label]'))
    .filter(inside)
    .map((el) => el.getAttribute('alt') || el.getAttribute('aria-label'))
    .filter(Boolean)
    .slice(0, 4);
  const figure = hit?.closest?.('figure');
  const caption = figure?.querySelector('figcaption')?.innerText || '';
  let block = hit?.closest?.(BLOCKS) || hit;
  while (block && block.parentElement && block !== document.body && (block.innerText || '').length < 300) block = block.parentElement;
  return { alt: clean(alts.join(' | '), 600), caption: clean(caption, 800), nearby: clean(block?.innerText, 1200) };
}

function pinRect(id, rect, usePicked) {
  if (usePicked && picked?.isConnected) anchors.set(id, { kind: 'element', element: picked });
  else anchors.set(id, { kind: 'rect', x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height });
  picked = null;
  startLoop();
  return describeRegion(rect);
}

// ---------- position tracking ----------
function anchorRect(anchor) {
  if (anchor.kind === 'rect') return { x: anchor.x - window.scrollX, y: anchor.y - window.scrollY, width: anchor.width, height: anchor.height };
  if (anchor.kind === 'element') return anchor.element.isConnected ? rectOf(anchor.element.getBoundingClientRect()) : null;
  if (!anchor.range.startContainer.isConnected) return null;
  return rectOf(anchor.range.getBoundingClientRect());
}

function frame() {
  const out = {};
  for (const [id, anchor] of anchors) out[id] = anchorRect(anchor);
  const live = liveSignature ? liveSelection() : null;
  if (live) {
    const last = live.rects[live.rects.length - 1];
    out.live = { rect: rectOf(live.range.getBoundingClientRect()), end: rectOf(last) };
  }
  if (hovered) {
    if (hovered.isConnected) out.hover = rectOf(hovered.getBoundingClientRect());
    else hovered = null;
  }
  const serialised = JSON.stringify(out, (_key, value) => (typeof value === 'number' ? Math.round(value * 2) / 2 : value));
  if (serialised !== lastFrame) {
    lastFrame = serialised;
    toHost('anchors', { anchors: out });
  }
  if (anchors.size === 0 && !liveSignature && !hovered) {
    looping = false;
    lastFrame = '';
    return;
  }
  requestAnimationFrame(frame);
}

function startLoop() {
  if (looping) return;
  looping = true;
  requestAnimationFrame(frame);
}

// ---------- page text ----------
function pageText() {
  const candidates = [document.querySelector('article'), document.querySelector('main'), document.querySelector('[role="main"]'), document.body];
  let best = '';
  for (const el of candidates) {
    const text = el?.innerText || '';
    if (text.length > 1500) {
      best = text;
      break;
    }
    if (text.length > best.length) best = text;
  }
  if (best.length < 1500) best = document.body?.innerText || best;
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  return {
    url: location.href,
    title: document.title,
    description: clean(description, 400),
    text: String(best).replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 60000),
  };
}

ipcRenderer.on(CHANNEL, (_event, msg) => {
  switch (msg?.type) {
    case 'pin':
      toHost('pinned', { id: msg.id, ok: pin(msg.id) });
      break;
    case 'unpin':
      unpin(msg.id);
      break;
    case 'pin-rect':
      toHost('rect-info', { id: msg.id, ...pinRect(msg.id, msg.rect, msg.picked) });
      break;
    case 'demote':
      setPast(msg.id, true, false);
      break;
    case 'promote':
      setPast(msg.id, false, true);
      break;
    case 'pick-hovered':
      if (lastHovered?.isConnected) {
        picked = lastHovered;
        toHost('pick', { rect: rectOf(lastHovered.getBoundingClientRect()) });
      }
      break;
    case 'scroll-by':
      window.scrollBy({ top: Number(msg.dy) || 0, behavior: 'smooth' });
      break;
    case 'clear-selection':
      window.getSelection()?.removeAllRanges();
      break;
    case 'get-page':
      toHost('page', { requestId: msg.requestId, page: pageText() });
      break;
    default:
  }
});
