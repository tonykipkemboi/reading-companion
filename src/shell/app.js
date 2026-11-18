// App shell: address bar, the page view, and the companion that explains what you highlight.
(() => {
  'use strict';

  const api = window.companion;
  document.body.classList.toggle('is-mac', navigator.userAgent.includes('Macintosh'));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), Math.max(lo, hi));
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const el = {
    stage: $('#stage'),
    tabList: $('#tab-list'),
    tabNew: $('#tab-new'),
    keyBtn: $('#key-btn'),
    keygate: $('#keygate'),
    keygateStatus: $('#keygate-status'),
    url: $('#url'),
    address: $('#address'),
    addressIcon: $('.address-icon'),
    back: $('#nav-back'),
    forward: $('#nav-forward'),
    reload: $('#nav-reload'),
    homeBtn: $('#nav-home'),
    snipBtn: $('#tool-snip'),
    askBtn: $('#tool-ask'),
    powered: $('#powered'),
    home: $('#home'),
    homeForm: $('#home-form'),
    homeUrl: $('#home-url'),
    homeMascot: $('#home-mascot'),
    homeRecent: $('#home-recent'),
    pickRow: $('#pick-row'),
    loadError: $('#load-error'),
    loadErrorText: $('#load-error-text'),
    loadErrorRetry: $('#load-error-retry'),
    pill: $('#pill'),
    bubble: $('#bubble'),
    bubbleHead: $('.bubble-head'),
    bubbleStatus: $('#bubble-status'),
    bubbleFocus: $('#bubble-focus'),
    bubbleBody: $('#bubble-body'),
    bubbleChips: $('#bubble-chips'),
    bubbleForm: $('#bubble-form'),
    bubbleInput: $('#bubble-input'),
    bubbleSend: $('#bubble-send'),
    bubbleFoot: $('#bubble-foot'),
    bubbleCopy: $('#bubble-copy'),
    bubbleClose: $('#bubble-close'),
    mascot: $('#mascot'),
    mascotArt: $('#mascot-art'),
    tip: $('#tip'),
    snip: $('#snip'),
    snipBox: $('#snip-box'),
    regionOutline: $('#region-outline'),
    markers: $('#markers'),
    imgchip: $('#imgchip'),
    notesBtn: $('#tool-notes'),
    notesCount: $('#notes-count'),
    notesPanel: $('#notes-panel'),
    notesList: $('#notes-list'),
    notesClear: $('#notes-clear'),
    bubbleRemove: $('#bubble-remove'),
  };

  const MASCOT_SIZE = 76;
  const BUBBLE_GAP = 14;
  const SEARCH_URL = 'https://duckduckgo.com/?q=';

  // What the whole window shares.
  const state = {
    config: null,
    mascotKey: 'quippy',
    snipping: false,
    tipShown: false,
    homeOffset: { right: 28, bottom: 28 },
    recent: [],
  };

  // ---------- tabs ----------
  // Each tab owns a page view and everything that belongs to its page. `tab` is the one on
  // screen; `state.home`, `state.thread`, `el.view` and friends always mean that tab's.
  const tabs = [];
  let tab = null;
  const PER_TAB = {
    home: true, // showing the home screen instead of a page
    hasPage: false,
    viewReady: false,
    zoom: 1,
    live: null, // current text selection in the page: { text, context, rect, end }
    thread: null, // the open note
    pageCache: null,
    lastUrl: '',
  };
  for (const key of [...Object.keys(PER_TAB), 'notes']) {
    Object.defineProperty(state, key, {
      get: () => tab[key],
      set: (value) => {
        tab[key] = value;
      },
    });
  }
  Object.defineProperty(el, 'view', { get: () => tab.view });

  function makeTab() {
    const view = document.createElement('webview');
    view.className = 'view';
    view.setAttribute('partition', 'persist:reader');
    // Lets pages ask for a new window; the background process never creates one and
    // opens the address in a new tab instead.
    view.setAttribute('allowpopups', '');
    el.stage.prepend(view);
    const created = { id: uid(), view, title: '', loading: false, failed: '', notes: [], ...PER_TAB };
    attachView(created);
    tabs.push(created);
    return created;
  }

  const tabLabel = (item) => {
    if (item.home && !item.hasPage) return 'New tab';
    if (item.title) return item.title;
    try {
      return new URL(item.lastUrl).hostname.replace(/^www\./, '');
    } catch {
      return 'Loading';
    }
  };

  function renderTabs() {
    el.tabList.replaceChildren();
    for (const item of tabs) {
      const button = document.createElement('div');
      button.className = 'tab';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(item === tab));
      button.classList.toggle('loading', item.loading);
      button.title = tabLabel(item);
      const dot = document.createElement('i');
      dot.className = 'tab-dot';
      const label = document.createElement('span');
      label.className = 'tab-title';
      label.textContent = tabLabel(item);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.title = 'Close tab';
      const x = document.createElement('i');
      x.className = 'icon';
      setIcon(x, 'xmark');
      close.append(x);
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        closeTab(item);
      });
      button.append(dot, label, close);
      button.addEventListener('mousedown', (event) => {
        if (event.button === 0 && !event.target.closest('.tab-close')) switchTab(item);
      });
      button.addEventListener('auxclick', (event) => {
        if (event.button === 1) closeTab(item);
      });
      el.tabList.append(button);
    }
  }

  // Puts a tab on screen: its page, its address, its notes.
  function switchTab(next) {
    if (next === tab) return;
    if (tab) {
      cancelSnip();
      closeThread(); // stays as a note in the tab being left
      hidePill();
      hideTip();
      toPage({ type: 'clear-selection' });
      tab.live = null;
    }
    tab = next;
    for (const item of tabs) item.view.classList.toggle('active', item === next);
    el.notesPanel.hidden = true;
    el.imgchip.hidden = true;
    document.body.classList.toggle('home-on', next.home);
    document.body.classList.toggle('loading', next.loading);
    document.body.classList.toggle('loaded', !next.loading);
    el.url.value = next.hasPage ? next.lastUrl : '';
    setIcon(el.addressIcon, next.lastUrl.startsWith('https://') ? 'lock' : 'globe');
    el.loadErrorText.textContent = next.failed;
    el.loadError.hidden = !next.failed;
    updateNav();
    renderNotes();
    renderTabs();
    updateMascot(true);
    if (next.home) {
      renderRecent();
      el.homeUrl.value = '';
      setTimeout(() => el.homeUrl.focus(), 30);
    }
  }

  function newTab(url) {
    switchTab(makeTab());
    if (url) go(url);
  }

  function closeTab(item) {
    const index = tabs.indexOf(item);
    if (index < 0) return;
    if (tabs.length === 1) newTab(); // closing the last tab leaves a fresh one
    else if (item === tab) switchTab(tabs[index + 1] || tabs[index - 1]);
    tabs.splice(tabs.indexOf(item), 1);
    item.view.remove();
    renderTabs();
  }

  function stepTab(delta) {
    if (tabs.length < 2) return;
    switchTab(tabs[(tabs.indexOf(tab) + delta + tabs.length) % tabs.length]);
  }

  // The window always has at least one tab.
  tab = makeTab();
  tab.view.classList.add('active');

  // ---------- icons ----------
  function setIcon(node, name) {
    const icon = name || node.dataset.icon;
    node.dataset.icon = icon;
    const url = `url("../../assets/icons/${icon}.svg")`;
    node.style.webkitMaskImage = url;
    node.style.maskImage = url;
  }
  $$('[data-icon]').forEach((node) => setIcon(node));

  // ---------- markdown ----------
  window.marked.setOptions({ gfm: true, breaks: true });
  const SAFE_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'code', 'pre', 'a', 'blockquote', 'h3', 'h4', 'h5', 'hr'];
  function renderMarkdown(text) {
    const html = window.marked.parse(String(text || ''));
    const clean = window.DOMPurify.sanitize(html, { ALLOWED_TAGS: SAFE_TAGS, ALLOWED_ATTR: ['href'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false });
    // A link in an answer shows where it really goes (the site's name follows the link
    // text), so wording written by a page cannot dress up a link to somewhere else.
    const holder = document.createElement('template');
    holder.innerHTML = clean;
    for (const link of holder.content.querySelectorAll('a')) {
      let host = '';
      try {
        const target = new URL(link.getAttribute('href'));
        if (target.protocol === 'https:' || target.protocol === 'http:') host = target.hostname.replace(/^www\./, '');
      } catch { /* not a usable address */ }
      if (host) {
        link.dataset.host = host;
        link.title = link.getAttribute('href');
      } else {
        link.removeAttribute('href');
      }
    }
    return holder.innerHTML;
  }

  // ---------- geometry ----------
  const stageSize = () => ({ w: el.stage.clientWidth, h: el.stage.clientHeight });
  const fromPage = (r) => (r ? { x: r.x * state.zoom, y: r.y * state.zoom, width: r.width * state.zoom, height: r.height * state.zoom } : null);
  const toPageRect = (r) => ({ x: r.x / state.zoom, y: r.y / state.zoom, width: r.width / state.zoom, height: r.height / state.zoom });
  const place = (node, x, y) => {
    node.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
  };

  // ---------- talking to the page ----------
  const pending = new Map();
  function toPage(message) {
    if (!state.viewReady) return false;
    try {
      el.view.send('rc', message);
      return true;
    } catch {
      return false;
    }
  }
  function pageRequest(message, timeout = 2500) {
    return new Promise((resolve) => {
      const key = message.requestId || message.id;
      const timer = setTimeout(() => {
        pending.delete(key);
        resolve(null);
      }, timeout);
      pending.set(key, (payload) => {
        clearTimeout(timer);
        pending.delete(key);
        resolve(payload);
      });
      if (!toPage(message)) {
        clearTimeout(timer);
        pending.delete(key);
        resolve(null);
      }
    });
  }

  async function getPage() {
    const url = currentUrl();
    if (state.pageCache && state.pageCache.url === url && Date.now() - state.pageCache.at < 20000) return state.pageCache.page;
    const reply = await pageRequest({ type: 'get-page', requestId: uid() });
    const page = reply?.page || { url, title: el.view.getTitle?.() || '', text: '' };
    if (page.kind === 'pdf') {
      // The PDF viewer shows the pages but keeps their text; the background process reads it.
      const view = el.view;
      const pdf = await api.readPdf(view.getWebContentsId()).catch(() => ({ ok: false, reason: 'unreadable' }));
      if (view !== el.view || currentUrl() !== url) return page; // the reader moved on meanwhile
      page.url = url;
      page.text = pdf.ok ? pdf.text : '';
      page.title = (pdf.ok && pdf.title) || page.title || url.split(/[?#]/)[0].split('/').pop() || '';
      page.pdf = pdf.ok ? { pages: pdf.pages, pagesRead: pdf.pagesRead } : { problem: pdf.reason, pages: pdf.pages || 0 };
    }
    state.pageCache = { url, at: Date.now(), page };
    return page;
  }

  // A PDF is shown by the app's own viewer page. Everywhere the reader or the model sees
  // an address, it is the PDF's own address, not the viewer's.
  function shownUrl(url) {
    if (typeof url !== 'string' || !url.startsWith('reader-pdf://viewer/')) return url;
    try {
      return new URL(url).searchParams.get('src') || url;
    } catch {
      return url;
    }
  }

  function currentUrl() {
    try {
      return state.viewReady ? shownUrl(el.view.getURL()) : state.lastUrl;
    } catch {
      return state.lastUrl;
    }
  }

  // ---------- navigation ----------
  function toUrl(input) {
    const value = String(input || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^localhost(:\d+)?/i.test(value) && !/^[\w.-]+:\d+/.test(value)) return ''; // other schemes are not web pages
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(value)) return `http://${value}`;
    if (!/\s/.test(value) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(value)) return `https://${value}`;
    return `${SEARCH_URL}${encodeURIComponent(value)}`;
  }

  function go(input) {
    const url = toUrl(input);
    if (!url) return;
    closeThread();
    hidePill();
    el.loadError.hidden = true;
    tab.failed = '';
    tab.title = '';
    state.hasPage = true;
    state.lastUrl = url;
    el.url.value = url;
    setHome(false);
    el.view.src = url;
    el.view.focus();
    renderTabs();
  }

  function setHome(on) {
    state.home = on;
    document.body.classList.toggle('home-on', on);
    if (on) {
      cancelSnip();
      closeThread();
      hidePill();
      hideTip();
      renderRecent();
      el.homeUrl.value = '';
      setTimeout(() => el.homeUrl.focus(), 30);
    } else {
      updateMascot(true);
    }
    el.loadError.hidden = on || !tab.failed;
    renderTabs();
  }

  function updateNav() {
    let back = false;
    let forward = false;
    try {
      back = state.viewReady && el.view.canGoBack();
      forward = state.viewReady && el.view.canGoForward();
    } catch { /* not attached yet */ }
    el.back.disabled = !back;
    el.forward.disabled = !forward;
  }

  function showUrl(url) {
    if (!url || url === 'about:blank') return;
    state.lastUrl = url;
    if (document.activeElement !== el.url) el.url.value = url;
    setIcon(el.addressIcon, url.startsWith('https://') ? 'lock' : 'globe');
  }

  function rememberPage(url, title) {
    if (!/^https?:/i.test(url)) return;
    const rest = state.recent.filter((item) => item.url !== url);
    state.recent = [{ url, title: title || url }, ...rest].slice(0, 4);
    api.saveSettings({ recent: state.recent });
  }

  function renderRecent() {
    const list = $('#recent-list');
    list.replaceChildren();
    el.homeRecent.hidden = state.recent.length === 0;
    for (const item of state.recent) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'recent-row';
      row.title = item.url;
      const title = document.createElement('b');
      title.textContent = item.title || item.url;
      const host = document.createElement('span');
      try {
        host.textContent = new URL(item.url).hostname.replace(/^www\./, '');
      } catch {
        host.textContent = '';
      }
      row.append(title, host);
      row.addEventListener('click', () => go(item.url));
      list.append(row);
    }
  }

  el.address.addEventListener('submit', (event) => {
    event.preventDefault();
    go(el.url.value);
  });
  el.url.addEventListener('focus', () => setTimeout(() => el.url.select(), 0));
  el.homeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    go(el.homeUrl.value);
  });
  el.back.addEventListener('click', () => el.view.goBack());
  el.forward.addEventListener('click', () => el.view.goForward());
  el.reload.addEventListener('click', () => {
    if (state.hasPage) el.view.reload();
  });
  el.homeBtn.addEventListener('click', () => setHome(!(state.home && state.hasPage)));
  el.powered.addEventListener('click', (event) => {
    event.preventDefault();
    api.openTokenFactory();
  });
  el.loadErrorRetry.addEventListener('click', () => go(state.lastUrl));
  // Always-visible way to the settings file, for adding or changing the API key.
  $('#home-settings').addEventListener('click', () => api.openSettings());

  // ---------- page view events ----------
  // Wires one tab's page view. Every handler updates that tab's own record; the window's
  // toolbar, notes and companion only change when the tab is the one on screen.
  function attachView(owner) {
    const view = owner.view;
    const onScreen = () => owner === tab;

    view.addEventListener('dom-ready', () => {
      owner.viewReady = true;
      // The open highlight is always dark evergreen on pink so it reads on light and dark sites alike.
      view.insertCSS('::highlight(rc-pin){background-color:#FF8FC4 !important;color:#091E19 !important;}::highlight(rc-past){background-color:rgba(255,122,184,0.36) !important;}').catch(() => {});
      try {
        view.setZoomFactor(owner.zoom);
      } catch { /* ignore */ }
      if (onScreen()) updateNav();
    });
    view.addEventListener('did-start-loading', () => {
      owner.loading = true;
      if (onScreen()) {
        document.body.classList.remove('loaded');
        document.body.classList.add('loading');
      }
      renderTabs();
    });
    view.addEventListener('did-stop-loading', () => {
      owner.loading = false;
      let url = owner.lastUrl;
      let title = owner.title;
      try {
        url = shownUrl(view.getURL()) || url;
        title = view.getTitle() || title;
      } catch { /* not attached */ }
      if (url && url !== 'about:blank') owner.lastUrl = url;
      owner.title = title;
      renderTabs();
      if (!owner.failed) rememberPage(url, title);
      if (!onScreen()) return;
      document.body.classList.remove('loading');
      document.body.classList.add('loaded');
      updateNav();
      showUrl(url);
      if (!owner.failed && !state.tipShown && !owner.home && /^https?:/i.test(url)) {
        state.tipShown = true;
        setTimeout(() => showTip(`Highlight anything and I will explain it.`), 500);
      }
    });
    view.addEventListener('page-title-updated', (event) => {
      owner.title = event.title || owner.title;
      renderTabs();
    });
    view.addEventListener('did-navigate', (event) => {
      const url = shownUrl(event.url);
      if (url && url !== 'about:blank') owner.lastUrl = url;
      owner.pageCache = null;
      owner.live = null;
      owner.failed = '';
      owner.title = '';
      if (onScreen()) {
        showUrl(url);
        hidePill();
        closeThread();
      }
      owner.notes = []; // notes belong to the page that just went away
      renderTabs();
      if (!onScreen()) return;
      el.notesPanel.hidden = true;
      el.imgchip.hidden = true;
      renderNotes();
      el.loadError.hidden = true;
      updateNav();
    });
    view.addEventListener('did-navigate-in-page', (event) => {
      if (!event.isMainFrame) return;
      owner.lastUrl = shownUrl(event.url) || owner.lastUrl;
      owner.pageCache = null;
      if (!onScreen()) return;
      showUrl(owner.lastUrl);
      updateNav();
    });
    view.addEventListener('did-fail-load', (event) => {
      if (!event.isMainFrame || event.errorCode === -3) return; // -3 is a cancelled load, not a failure
      owner.failed = `${event.validatedURL || owner.lastUrl} could not be reached (${event.errorDescription || 'network error'}).`;
      if (!onScreen()) return;
      el.loadErrorText.textContent = owner.failed;
      el.loadError.hidden = false;
    });
    view.addEventListener('ipc-message', (event) => {
      if (event.channel === 'rc') onPageMessage(owner, event.args[0] || {});
    });
  }

  function onPageMessage(owner, msg) {
    if (owner !== tab) {
      // A tab in the background: keep its notes' positions fresh and answer pending requests,
      // but leave the window's own interface alone.
      if (msg.type === 'anchors') {
        for (const note of owner.notes) {
          const r = note.anchorId && msg.anchors?.[note.anchorId];
          if (r) note.rect = { x: r.x * owner.zoom, y: r.y * owner.zoom, width: r.width * owner.zoom, height: r.height * owner.zoom };
        }
      } else if (msg.type === 'page' || msg.type === 'rect-info' || msg.type === 'pinned') {
        pending.get(msg.requestId || msg.id)?.(msg);
      }
      return;
    }
    switch (msg.type) {
      case 'selection':
        state.live = { text: msg.text, context: msg.context, rect: fromPage(msg.rect), end: fromPage(msg.end) };
        hideTip();
        showPill();
        break;
      case 'selection-cleared':
        state.live = null;
        hidePill();
        break;
      case 'anchors': {
        const anchors = msg.anchors || {};
        if (anchors.live && state.live) {
          state.live.rect = fromPage(anchors.live.rect);
          state.live.end = fromPage(anchors.live.end);
          positionPill();
        }
        for (const note of state.notes) {
          if (!note.anchorId || !anchors[note.anchorId]) continue;
          note.rect = fromPage(anchors[note.anchorId]);
          if (note === state.thread) positionBubble();
          else positionMarker(note);
        }
        if (anchors.hover) showChip(fromPage(anchors.hover));
        break;
      }
      case 'hover-end':
        hideChipSoon();
        break;
      case 'anchor-click': {
        const note = state.notes.find((item) => item.anchorId === msg.id);
        if (note) reopenThread(note);
        break;
      }
      case 'pointerdown':
        el.notesPanel.hidden = true;
        break;
      case 'pick':
        startRegionThread(clipToStage(fromPage(msg.rect)), { picked: true });
        break;
      case 'escape':
        onEscape();
        break;
      case 'page':
      case 'rect-info':
      case 'pinned': {
        const key = msg.requestId || msg.id;
        pending.get(key)?.(msg);
        break;
      }
      default:
    }
  }

  // ---------- mascot ----------
  // COMPANION_NAME in .env renames the companion without touching its design.
  const mascotName = () => state.config?.mascotName || window.Mascots.get(state.mascotKey).name;
  let mascotStateTimer = 0;

  function setMascotKey(key, persist = false) {
    state.mascotKey = window.Mascots.has(key) ? key : 'quippy';
    el.mascotArt.innerHTML = window.Mascots.svg(state.mascotKey);
    el.homeMascot.innerHTML = window.Mascots.svg(state.mascotKey);
    $$('[data-mascot-name]').forEach((node) => {
      node.textContent = mascotName();
    });
    el.mascot.title = `Ask ${mascotName()} about this page`;
    $$('.pick-card').forEach((card) => card.setAttribute('aria-pressed', String(card.dataset.key === state.mascotKey)));
    if (persist) api.saveSettings({ mascot: state.mascotKey });
  }

  function renderPicker() {
    el.pickRow.replaceChildren();
    for (const key of window.Mascots.keys) {
      const mascot = window.Mascots.get(key);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'pick-card';
      card.dataset.key = key;
      const art = document.createElement('div');
      art.className = 'pick-art';
      art.innerHTML = window.Mascots.svg(key);
      const copy = document.createElement('div');
      const name = document.createElement('h3');
      name.textContent = mascot.name;
      const blurb = document.createElement('p');
      blurb.textContent = mascot.blurb;
      copy.append(name, blurb);
      const badge = document.createElement('span');
      badge.className = 'pick-badge';
      badge.textContent = 'with you';
      card.append(art, copy, badge);
      card.addEventListener('click', () => {
        setMascotKey(key, true);
        $('#pick-pop').hidden = true;
      });
      el.pickRow.append(card);
    }
  }

  // The chooser opens from the home screen's footer link or by clicking the companion there.
  const togglePicker = (event) => {
    event.stopPropagation();
    $('#pick-pop').hidden = !$('#pick-pop').hidden;
  };
  $('#home-companion').addEventListener('click', togglePicker);
  el.homeMascot.addEventListener('click', togglePicker);
  el.home.addEventListener('click', (event) => {
    if (!event.target.closest('#pick-pop')) $('#pick-pop').hidden = true;
  });

  // Moods: idle, notice, think, talk, happy, held, oops, sleep (posed in styles.css).
  let lastStir = Date.now(); // the last time anything happened to the companion
  let nextFidgetAt = Date.now() + 9000;
  function setMascotState(name, revertAfter = 0) {
    clearTimeout(mascotStateTimer);
    el.mascot.dataset.state = name;
    if (name !== 'sleep') lastStir = Date.now();
    if (revertAfter) mascotStateTimer = setTimeout(() => {
      el.mascot.dataset.state = 'idle';
    }, revertAfter);
  }

  // Left to itself, the companion fidgets now and then, and dozes off after a long quiet spell.
  const FIDGETS = ['fidget-tilt', 'fidget-hop', 'fidget-peek', 'fidget-peek'];
  const SLEEP_AFTER = 90000;
  function fidget(kind) {
    el.mascot.classList.remove(...FIDGETS);
    void el.mascot.offsetWidth;
    el.mascot.classList.add(kind);
    setTimeout(() => el.mascot.classList.remove(kind), 1800);
  }
  setInterval(() => {
    const mood = el.mascot.dataset.state;
    if (state.home || dragging || document.hidden || state.thread || !el.pill.hidden) {
      lastStir = Date.now();
      return;
    }
    const now = Date.now();
    if (mood === 'idle' && now - lastStir > SLEEP_AFTER) {
      setMascotState('sleep');
    } else if (mood === 'idle' && now > nextFidgetAt) {
      fidget(FIDGETS[Math.floor(Math.random() * FIDGETS.length)]);
      nextFidgetAt = now + 8000 + Math.random() * 7000;
    }
  }, 1000);

  function homePosition() {
    const { w, h } = stageSize();
    return {
      x: clamp(w - MASCOT_SIZE - state.homeOffset.right, 4, w - MASCOT_SIZE - 4),
      y: clamp(h - MASCOT_SIZE - state.homeOffset.bottom, 4, h - MASCOT_SIZE - 4),
    };
  }

  let mascotPos = { x: 0, y: 0 };
  let movingTimer = 0;
  function moveMascot(x, y, instant = false) {
    const { w, h } = stageSize();
    const next = { x: clamp(x, 4, w - MASCOT_SIZE - 4), y: clamp(y, 4, h - MASCOT_SIZE - 4) };
    const dx = next.x - mascotPos.x;
    const distance = Math.hypot(dx, next.y - mascotPos.y);
    // A position refresh for the spot it is already gliding to must not cut the glide short.
    if (instant && distance < 3 && el.mascot.classList.contains('moving')) return;
    mascotPos = next;
    el.mascot.classList.toggle('instant', instant);
    el.mascot.style.setProperty('--x', `${Math.round(next.x)}px`);
    el.mascot.style.setProperty('--y', `${Math.round(next.y)}px`);
    if (!instant && distance > 60) {
      // Lean into the trip, then settle with a small squash when it arrives.
      el.mascot.style.setProperty('--lean', `${dx < 0 ? -10 : 10}deg`);
      el.mascot.classList.remove('landed');
      el.mascot.classList.add('moving');
      clearTimeout(movingTimer);
      movingTimer = setTimeout(() => {
        el.mascot.classList.remove('moving');
        el.mascot.classList.add('landed');
        setTimeout(() => el.mascot.classList.remove('landed'), 400);
      }, 430);
    }
  }

  function lookAt(point) {
    const cx = mascotPos.x + MASCOT_SIZE / 2;
    const cy = mascotPos.y + MASCOT_SIZE / 2;
    let lx = 0;
    let ly = 0;
    if (point) {
      const dx = point.x - cx;
      const dy = point.y - cy;
      const length = Math.hypot(dx, dy) || 1;
      lx = (dx / length) * 2.6;
      ly = (dy / length) * 2.2;
    }
    el.mascot.style.setProperty('--lx', lx.toFixed(2));
    el.mascot.style.setProperty('--ly', ly.toFixed(2));
  }

  // Decides where the mascot belongs right now: perched on the bubble, beside the pill, or at home.
  function updateMascot(instant = false) {
    if (dragging) return;
    const { w } = stageSize();
    const thread = state.thread;
    if (thread && !el.bubble.hidden && thread.kind !== 'page' && thread.box) {
      const box = thread.box;
      // Above the highlight: sit on the bubble's top corner. Below it: stand beside the bubble,
      // so the mascot never covers the passage being explained.
      let x = box.x - 34;
      let y = box.y - 56;
      if (el.bubble.dataset.side !== 'above' || y < 4) {
        y = box.y + 2;
        x = box.x - MASCOT_SIZE + 12;
        if (x < 4) x = Math.min(box.x + box.width - 12, w - MASCOT_SIZE - 4);
      }
      moveMascot(x, y, instant || thread.following);
      lookAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
      // Which side the note is on, so the pointing hand comes out on that side.
      el.mascot.dataset.point = box.x + box.width / 2 >= mascotPos.x + MASCOT_SIZE / 2 ? 'right' : 'left';
      return;
    }
    if (!el.pill.hidden && state.live) {
      const px = pillPos.x;
      const py = pillPos.y;
      let x = px - MASCOT_SIZE - 4;
      if (x < 4) x = px + el.pill.offsetWidth + 4;
      moveMascot(x, py - 6, instant || pillFollowing);
      lookAt({ x: state.live.rect.x + state.live.rect.width / 2, y: state.live.rect.y + state.live.rect.height / 2 });
      return;
    }
    const home = homePosition();
    moveMascot(home.x, home.y, instant);
    lookAt(null);
  }

  // Pointing at a dozing companion wakes it.
  el.mascot.addEventListener('mouseenter', () => {
    if (el.mascot.dataset.state === 'sleep') setMascotState('notice', 800);
  });

  // Click = ask about the page. Drag = move the mascot's home spot.
  let dragging = false;
  el.mascot.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY, mx: mascotPos.x, my: mascotPos.y };
    let moved = false;
    el.mascot.setPointerCapture(event.pointerId);
    const onMove = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      if (!moved) setMascotState('held');
      moved = true;
      dragging = true;
      el.mascot.classList.add('dragging');
      moveMascot(start.mx + dx, start.my + dy, true);
    };
    const onUp = () => {
      el.mascot.removeEventListener('pointermove', onMove);
      el.mascot.removeEventListener('pointerup', onUp);
      el.mascot.removeEventListener('pointercancel', onUp);
      el.mascot.classList.remove('dragging');
      if (moved) {
        const { w, h } = stageSize();
        state.homeOffset = { right: w - MASCOT_SIZE - mascotPos.x, bottom: h - MASCOT_SIZE - mascotPos.y };
        try {
          localStorage.setItem('mascot-home', JSON.stringify(state.homeOffset));
        } catch { /* ignore */ }
        dragging = false;
        setMascotState('happy', 700);
        if (state.thread?.kind === 'page') positionBubble();
      } else {
        dragging = false;
        if (state.thread?.kind === 'page') closeThread();
        else startPageThread();
      }
    };
    el.mascot.addEventListener('pointermove', onMove);
    el.mascot.addEventListener('pointerup', onUp);
    el.mascot.addEventListener('pointercancel', onUp);
  });

  // ---------- tip ----------
  let tipTimer = 0;
  function showTip(text, duration = 6500) {
    if (state.home || state.thread || !el.pill.hidden) return;
    el.tip.textContent = text;
    el.tip.hidden = false;
    const home = homePosition();
    const { w } = stageSize();
    const x = clamp(home.x + MASCOT_SIZE - el.tip.offsetWidth - 10, 8, w - el.tip.offsetWidth - 8);
    place(el.tip, x, home.y - el.tip.offsetHeight - 6);
    setMascotState('notice', 900);
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, duration);
  }
  function hideTip() {
    clearTimeout(tipTimer);
    el.tip.hidden = true;
  }

  // ---------- selection pill ----------
  let pillPos = { x: 0, y: 0 };
  let pillFollowing = false;
  function positionPill() {
    if (el.pill.hidden || !state.live) return;
    const { w, h } = stageSize();
    const end = state.live.end;
    const width = el.pill.offsetWidth;
    const height = el.pill.offsetHeight;
    let x = end.x + end.width - width / 2;
    let y = end.y + end.height + 10;
    if (y + height > h - 8) y = state.live.rect.y - height - 10;
    // Leave room on the left for the mascot to stand next to the pill.
    x = clamp(x, MASCOT_SIZE + 12, w - width - 8);
    y = clamp(y, 30, h - height - 8);
    pillPos = { x, y };
    place(el.pill, x, y);
    updateMascot();
  }
  function showPill() {
    if (state.snipping || state.home) return;
    const wasHidden = el.pill.hidden;
    el.pill.hidden = false;
    pillFollowing = !wasHidden;
    positionPill();
    pillFollowing = true;
    if (wasHidden) setMascotState('notice', 900);
  }
  function hidePill() {
    if (el.pill.hidden) return;
    el.pill.hidden = true;
    pillFollowing = false;
    updateMascot();
  }

  const PROMPTS = {
    explain: 'What does this mean?',
    simplify: 'Simpler: explain this with an everyday comparison.',
  };
  // Keep focus (and the selection) inside the page while the pill is clicked.
  el.pill.addEventListener('mousedown', (event) => event.preventDefault());
  el.pill.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) startSelectionThread(action);
  });

  // ---------- threads (the bubble) ----------
  const CHIPS = {
    selection: ['Simpler', 'Go deeper', 'Give an example'],
    region: ['Simpler', 'Go deeper', 'What should I notice?'],
    page: ['Simpler', 'Go deeper', 'What is the main point?'],
    pageStart: ['Summarize this page', 'Key takeaways', 'Explain it like I am new to this'],
  };

  function openBubble(thread, { restore = false } = {}) {
    state.thread = thread;
    if (!state.notes.includes(thread)) state.notes.push(thread);
    el.bubbleBody.replaceChildren();
    if (restore) {
      thread.turns.forEach((turn, index) => {
        if (turn.role === 'user') {
          if (index > 0 || !thread.silentFirst) addUserMessage(turn);
        } else if (turn.content) {
          addMessage('msg-bot').innerHTML = renderMarkdown(turn.content);
        }
      });
    }
    el.bubbleInput.value = '';
    el.bubbleFocus.classList.toggle('is-image', thread.kind === 'region');
    el.bubbleFocus.replaceChildren();
    if (thread.kind === 'selection') {
      const quote = document.createElement('span');
      quote.className = 'focus-quote';
      quote.textContent = thread.focus.text;
      el.bubbleFocus.append(quote);
    }
    if (thread.kind === 'region') {
      const img = document.createElement('img');
      img.src = thread.focus.image;
      img.alt = 'Snipped region';
      el.bubbleFocus.append(img);
    }
    el.bubbleInput.placeholder = thread.kind === 'page' ? 'Ask about this page' : 'Ask a follow-up';
    showModel();
    el.regionOutline.hidden = thread.kind !== 'region';
    el.bubble.hidden = false;
    if (el.mascot.dataset.state === 'sleep') setMascotState('idle');
    autoGrow();
    el.bubble.style.animation = 'none';
    void el.bubble.offsetWidth;
    el.bubble.style.animation = '';
    setStatus('');
    renderChips();
    updateSendButton();
    renderNotes();
    renderAttachments();
    renderQuote();
    thread.following = true;
  }

  async function startSelectionThread(action) {
    const live = state.live;
    if (!live) return;
    closeThread();
    const id = uid();
    const thread = {
      id,
      kind: 'selection',
      anchorId: id,
      rect: { ...live.rect },
      focus: { type: 'selection', text: live.text, context: live.context },
      turns: [],
    };
    toPage({ type: 'pin', id });
    state.live = null;
    hidePill();
    makeRoom(thread);
    openBubble(thread);
    if (PROMPTS[action]) submit(PROMPTS[action], { silent: true });
    else el.bubbleInput.focus();
  }

  // When a highlight sits where neither side has room for a comfortable bubble, glide the page
  // up a little so the answer can open underneath it.
  const COMFORT = 440;
  function makeRoom(thread) {
    const { h } = stageSize();
    const rect = thread.rect;
    const spaceBelow = h - (rect.y + rect.height) - BUBBLE_GAP - 12;
    const spaceAbove = rect.y - BUBBLE_GAP - 12;
    if (spaceBelow >= COMFORT || spaceAbove >= COMFORT) return;
    const dy = Math.min(COMFORT - spaceBelow, rect.y - 24);
    if (dy < 24) return;
    thread.lockSide = 'below';
    toPage({ type: 'scroll-by', dy: dy / state.zoom });
  }

  function clipToStage(rect) {
    const { w, h } = stageSize();
    const x = clamp(rect.x, 0, w);
    const y = clamp(rect.y, 0, h);
    return { x, y, width: clamp(rect.x + rect.width, 0, w) - x, height: clamp(rect.y + rect.height, 0, h) - y };
  }

  async function startRegionThread(rect, { picked = false } = {}) {
    if (!rect || rect.width < 12 || rect.height < 12 || !state.viewReady) return;
    closeThread();
    hidePill();
    toPage({ type: 'clear-selection' });
    setMascotState('think');
    let image;
    try {
      image = await api.capture(el.view.getWebContentsId(), rect);
    } catch (err) {
      setMascotState('idle');
      showTip('That snip did not work. Try dragging again.');
      return;
    }
    const id = uid();
    const info = (await pageRequest({ type: 'pin-rect', id, rect: toPageRect(rect), picked })) || {};
    const thread = {
      id,
      kind: 'region',
      anchorId: id,
      rect: { ...rect },
      focus: { type: 'region', image, alt: info.alt || '', caption: info.caption || '', nearby: info.nearby || '' },
      turns: [],
    };
    openBubble(thread);
    submit('Explain what this shows.', { silent: true });
  }

  function startPageThread() {
    if (state.home || !state.hasPage) return;
    // One running conversation about the page: clicking the companion again picks it back up.
    const existing = state.notes.find((note) => note.kind === 'page');
    if (existing) {
      reopenThread(existing);
    } else {
      closeThread();
      hidePill();
      hideTip();
      openBubble({ id: uid(), kind: 'page', anchorId: null, rect: null, focus: { type: 'page' }, turns: [] });
    }
    el.bubbleInput.focus();
  }

  const hasAnswer = (thread) => thread.turns.some((turn) => turn.role === 'assistant' && turn.content);

  // Closing keeps the conversation as a note you can reopen; dismissing deletes it.
  function closeThread({ dismiss = false } = {}) {
    const thread = state.thread;
    if (!thread) return;
    if (thread.streaming) {
      api.cancel(thread.askId);
      thread.streaming = false;
      const last = thread.turns[thread.turns.length - 1];
      if (last?.role === 'assistant' && !last.content) thread.turns.splice(-2, 2);
    }
    thread.node = null;
    thread.detached = null;
    thread.lockSide = null;
    state.thread = null;
    el.bubble.hidden = true;
    el.regionOutline.hidden = true;
    $('#reply-pill').hidden = true;
    if (dismiss || !hasAnswer(thread)) dropNote(thread);
    else if (thread.anchorId) toPage({ type: 'demote', id: thread.anchorId });
    setMascotState('idle');
    renderNotes();
    updateMascot();
  }

  function dropNote(note) {
    if (note.anchorId) toPage({ type: 'unpin', id: note.anchorId });
    state.notes = state.notes.filter((item) => item !== note);
  }

  function reopenThread(note) {
    if (state.thread === note) return;
    closeThread();
    hidePill();
    hideTip();
    el.notesPanel.hidden = true;
    if (note.anchorId) toPage({ type: 'promote', id: note.anchorId });
    openBubble(note, { restore: true });
  }

  // ---------- notes: markers on the page and the list in the toolbar ----------
  function positionMarker(note) {
    const marker = note.marker;
    const rect = note.rect;
    if (!marker || !rect) return;
    const { w, h } = stageSize();
    marker.hidden = rect.y + rect.height < 0 || rect.y > h;
    place(marker, clamp(rect.x + rect.width - 10, 4, w - 30), clamp(rect.y - 14, 4, h - 30));
  }

  function noteLabel(note) {
    if (note.kind === 'selection') return { kind: 'Highlight', icon: 'square-dashed-text', text: note.focus.text };
    if (note.kind === 'region') return { kind: 'Picture', icon: 'picture', text: note.focus.caption || note.focus.alt || 'Snipped picture' };
    const asked = note.turns.find((turn) => turn.role === 'user');
    return { kind: 'Page', icon: 'comment', text: asked?.content || 'About this page' };
  }

  function renderNotes() {
    const count = state.notes.length;
    el.notesBtn.disabled = count === 0;
    el.notesCount.hidden = count === 0;
    el.notesCount.textContent = String(count);
    if (count === 0) el.notesPanel.hidden = true;

    el.markers.replaceChildren();
    for (const note of state.notes) {
      note.marker = null;
      if (note === state.thread || !note.anchorId) continue;
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'marker';
      marker.title = `Reopen: ${noteLabel(note).text.slice(0, 80)}`;
      const icon = document.createElement('i');
      icon.className = 'icon';
      setIcon(icon, 'comment');
      marker.append(icon);
      marker.addEventListener('mousedown', (event) => event.preventDefault());
      marker.addEventListener('click', () => reopenThread(note));
      note.marker = marker;
      el.markers.append(marker);
      positionMarker(note);
    }

    el.notesList.replaceChildren();
    for (const note of state.notes) {
      const label = noteLabel(note);
      const row = document.createElement('div');
      row.className = 'note-row';
      row.classList.toggle('active', note === state.thread);
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const icon = document.createElement('i');
      icon.className = 'icon';
      setIcon(icon, label.icon);
      const copy = document.createElement('div');
      const kind = document.createElement('div');
      kind.className = 'note-kind';
      kind.textContent = label.kind;
      const text = document.createElement('div');
      text.className = 'note-text';
      text.textContent = label.text;
      copy.append(kind, text);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn small';
      remove.title = 'Delete this note';
      const x = document.createElement('i');
      x.className = 'icon';
      setIcon(x, 'trash-bin');
      remove.append(x);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        if (note === state.thread) closeThread({ dismiss: true });
        else {
          dropNote(note);
          renderNotes();
        }
      });
      row.append(icon, copy, remove);
      row.addEventListener('click', () => reopenThread(note));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') reopenThread(note);
      });
      el.notesList.append(row);
    }
  }

  el.notesBtn.addEventListener('click', () => {
    el.notesPanel.hidden = !el.notesPanel.hidden;
  });
  el.notesClear.addEventListener('click', () => {
    closeThread({ dismiss: true });
    for (const note of [...state.notes]) dropNote(note);
    renderNotes();
  });

  // ---------- "Explain picture" button on the picture under the pointer ----------
  let chipTimer = 0;
  let chipHover = false;
  function showChip(rect) {
    if (state.snipping || state.home || state.live || !el.pill.hidden) {
      el.imgchip.hidden = true;
      return;
    }
    clearTimeout(chipTimer);
    el.imgchip.hidden = false;
    const { w, h } = stageSize();
    const width = el.imgchip.offsetWidth;
    place(el.imgchip, clamp(rect.x + rect.width - width - 10, 8, w - width - 8), clamp(rect.y + 10, 8, h - 44));
  }
  function hideChipSoon() {
    clearTimeout(chipTimer);
    chipTimer = setTimeout(() => {
      if (!chipHover) el.imgchip.hidden = true;
    }, 500);
  }
  el.imgchip.addEventListener('mouseenter', () => {
    chipHover = true;
  });
  el.imgchip.addEventListener('mouseleave', () => {
    chipHover = false;
    hideChipSoon();
  });
  el.imgchip.addEventListener('mousedown', (event) => event.preventDefault());
  el.imgchip.addEventListener('click', () => {
    chipHover = false;
    el.imgchip.hidden = true;
    toPage({ type: 'pick-hovered' });
  });

  function setStatus(text) {
    el.bubbleStatus.textContent = text;
  }

  function renderChips() {
    const thread = state.thread;
    el.bubbleChips.replaceChildren();
    if (!thread || thread.streaming) return;
    const answered = thread.turns.some((turn) => turn.role === 'assistant' && turn.content);
    let labels = [];
    if (thread.kind === 'page' && !answered) labels = CHIPS.pageStart;
    else if (answered) labels = CHIPS[thread.kind];
    for (const label of labels) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = label;
      chip.addEventListener('click', () => submit(label));
      el.bubbleChips.append(chip);
    }
  }

  function addMessage(className, text) {
    const node = document.createElement('div');
    node.className = className;
    if (text) node.textContent = text;
    el.bubbleBody.append(node);
    return node;
  }

  function addNote(message) {
    const node = addMessage('msg-note');
    const icon = document.createElement('i');
    icon.className = 'icon';
    setIcon(icon, 'circle-exclamation');
    const text = document.createElement('span');
    // Show env var names and file names as code without trusting the message as HTML.
    for (const part of String(message).split(/(NEBIUS_[A-Z_]+=?)/g)) {
      if (/^NEBIUS_[A-Z_]+=?$/.test(part)) {
        const code = document.createElement('code');
        code.textContent = part;
        text.append(code);
      } else if (part) {
        text.append(part);
      }
    }
    node.append(icon, text);
    positionBubble();
    return node;
  }

  function updateSendButton() {
    const streaming = Boolean(state.thread?.streaming);
    setIcon($('.icon', el.bubbleSend), streaming ? 'stop-fill' : 'arrow-up');
    el.bubbleSend.title = streaming ? 'Stop' : 'Send';
  }

  async function submit(text, { silent = false } = {}) {
    const thread = state.thread;
    if (!thread || thread.streaming) return;
    // Pictures waiting in the note go out with this question.
    const images = (thread.attachments || []).splice(0);
    // So do words highlighted in an earlier answer.
    const quote = thread.quote || '';
    thread.quote = '';
    const question = String(text || '').trim() || (images.length ? 'What does this show?' : quote ? 'What does this part mean?' : '');
    if (!question) return;
    renderAttachments();
    renderQuote();
    if (thread.turns.length === 0) thread.silentFirst = silent && !images.length;
    const turn = { role: 'user', content: question };
    if (images.length) turn.images = images;
    if (quote) turn.quote = quote;
    thread.turns.push(turn);
    const asked = thread.turns.length === 1 && thread.silentFirst ? null : addUserMessage(turn);
    const node = addMessage('msg-bot');
    node.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    thread.scrollTo = asked || node;
    thread.turns.push({ role: 'assistant', content: '' });
    thread.node = node;
    thread.streaming = true;
    thread.userScrolled = false;
    thread.askId = uid();
    setStatus('reading');
    setMascotState('think');
    renderChips();
    updateSendButton();
    positionBubble();
    revealTurn(thread);

    const page = await getPage();
    if (state.thread !== thread || !thread.streaming) return;
    api.ask({ id: thread.askId, name: mascotName(), page, focus: thread.focus, turns: thread.turns.slice(0, -1) });
  }

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      const thread = state.thread;
      if (!thread?.node) return;
      const last = thread.turns[thread.turns.length - 1];
      if (!last?.content) return;
      thread.node.innerHTML = renderMarkdown(last.content);
      positionBubble();
      revealTurn(thread);
    });
  }

  // Scrolls the newest question (or answer) to the top of the bubble so reading starts at its first line.
  function revealTurn(thread) {
    const target = thread.scrollTo;
    if (!target?.isConnected || thread.userScrolled) return;
    el.bubbleBody.scrollTop = target.offsetTop - el.bubbleBody.offsetTop - 4;
  }
  el.bubbleBody.addEventListener('wheel', () => {
    if (state.thread) state.thread.userScrolled = true;
  }, { passive: true });

  function finishTurn(thread, { failed = false } = {}) {
    thread.streaming = false;
    const last = thread.turns[thread.turns.length - 1];
    if (last?.role === 'assistant' && !last.content) {
      // Nothing came back: drop the empty answer and its question so a retry starts clean.
      thread.turns.splice(-2, 2);
      thread.node?.remove();
    }
    thread.node = null;
    setStatus('');
    setMascotState(failed ? 'idle' : 'happy', failed ? 0 : 900);
    updateSendButton();
    renderChips();
    positionBubble();
  }

  api.onAskEvent((event) => {
    const thread = state.thread;
    if (!thread || event.id !== thread.askId) return;
    const last = thread.turns[thread.turns.length - 1];
    switch (event.type) {
      case 'model':
        // First the model the question was sent to, then the one the API says is answering.
        thread.model = { id: event.modelId, name: event.name };
        showModel();
        break;
      case 'thinking':
        setStatus('thinking');
        break;
      case 'delta':
        if (!last.content) {
          setStatus('');
          setMascotState('talk');
        }
        last.content += event.text;
        scheduleRender();
        break;
      case 'done':
        if (thread.node && last.content) thread.node.innerHTML = renderMarkdown(last.content);
        finishTurn(thread);
        if (event.finishReason === 'length') addNote('The answer hit the length limit. Ask a follow-up to continue, or raise NEBIUS_MAX_TOKENS in the settings file.');
        break;
      case 'aborted':
        finishTurn(thread, { failed: true });
        break;
      case 'error':
        finishTurn(thread, { failed: true });
        setMascotState('oops', 2800);
        if (event.code === 'missing-key' || event.code === 'bad-key') {
          // No usable key: the pop-up says what to do, and the empty note goes away.
          closeThread({ dismiss: true });
          loadConfig().then(() => showKeyGate());
        } else {
          addNote(event.message || 'Something went wrong.');
        }
        break;
      default:
    }
  });

  el.bubbleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const thread = state.thread;
    if (!thread) return;
    if (thread.streaming) {
      api.cancel(thread.askId);
      return;
    }
    const text = el.bubbleInput.value;
    if (!text.trim() && !thread.attachments?.length && !thread.quote) return;
    el.bubbleInput.value = '';
    autoGrow();
    submit(text);
  });

  // ---------- highlighting part of an answer ----------
  // Select words inside one of the companion's answers and the same three choices appear.
  // The follow-up stays in this note and carries the highlighted words with it.
  const replyPill = $('#reply-pill');
  const REPLY_PROMPTS = {
    explain: 'What does this part mean?',
    simplify: 'Simpler: explain this part with an everyday comparison.',
  };

  function answerSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const within = (node) => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest?.('#bubble-body .msg-bot');
    if (!within(range.startContainer) || !within(range.endContainer)) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return null;
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
    return rects.length ? { text: text.slice(0, 1500), last: rects[rects.length - 1] } : null;
  }

  function showReplyPill() {
    const picked = state.thread && !state.thread.streaming ? answerSelection() : null;
    if (!picked) {
      replyPill.hidden = true;
      return;
    }
    replyPill.dataset.text = picked.text;
    replyPill.hidden = false;
    const stageBox = el.stage.getBoundingClientRect();
    const { w, h } = stageSize();
    const width = replyPill.offsetWidth;
    const height = replyPill.offsetHeight;
    let y = picked.last.bottom - stageBox.top + 8;
    if (y + height > h - 6) y = picked.last.top - stageBox.top - height - 8;
    place(replyPill, clamp(picked.last.right - stageBox.left - width / 2, 6, w - width - 6), clamp(y, 6, h - height - 6));
  }
  const hideReplyPill = () => {
    replyPill.hidden = true;
  };

  el.bubbleBody.addEventListener('mouseup', () => setTimeout(showReplyPill, 10));
  el.bubbleBody.addEventListener('keyup', (event) => {
    if (event.shiftKey || event.key === 'Shift') showReplyPill();
  });
  el.bubbleBody.addEventListener('scroll', hideReplyPill, { passive: true });
  document.addEventListener('selectionchange', () => {
    if (!replyPill.hidden && !answerSelection()) hideReplyPill();
  });
  replyPill.addEventListener('mousedown', (event) => event.preventDefault()); // keep the selection
  replyPill.addEventListener('click', (event) => {
    const action = event.target.closest('[data-reply]')?.dataset.reply;
    const thread = state.thread;
    const text = replyPill.dataset.text;
    if (!action || !thread || !text) return;
    window.getSelection()?.removeAllRanges();
    hideReplyPill();
    thread.quote = text;
    if (REPLY_PROMPTS[action]) {
      submit(REPLY_PROMPTS[action]);
    } else {
      renderQuote();
      el.bubbleInput.focus();
    }
  });

  // The highlighted words wait above the question box until the question is sent.
  function renderQuote() {
    const quote = state.thread?.quote || '';
    $('#bubble-quote').hidden = !quote;
    $('#bubble-quote-text').textContent = quote;
    if (quote) el.bubbleInput.placeholder = 'Ask about the highlighted part';
    else if (!state.thread?.attachments?.length) el.bubbleInput.placeholder = state.thread?.kind === 'page' ? 'Ask about this page' : 'Ask a follow-up';
    positionBubble();
  }
  $('#bubble-quote-clear').addEventListener('click', () => {
    if (state.thread) state.thread.quote = '';
    renderQuote();
  });

  // ---------- pictures inside a note ----------
  // A reader can add pictures to the question they are about to ask: a snip of the page,
  // a file, something pasted, or something dropped on the note.
  const MAX_ATTACHMENTS = 4;

  function addUserMessage(turn) {
    const node = addMessage('msg-user');
    if (turn.images?.length) {
      const strip = document.createElement('div');
      strip.className = 'msg-images';
      for (const src of turn.images) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Attached picture';
        strip.append(img);
      }
      node.append(strip);
    }
    if (turn.quote) {
      const quote = document.createElement('div');
      quote.className = 'msg-quote';
      quote.textContent = turn.quote;
      node.append(quote);
    }
    node.append(turn.content);
    return node;
  }

  function renderAttachments() {
    const holder = $('#bubble-attachments');
    holder.replaceChildren();
    const list = state.thread?.attachments || [];
    list.forEach((src, index) => {
      const item = document.createElement('div');
      item.className = 'attachment';
      const img = document.createElement('img');
      img.src = src;
      img.alt = 'Picture to send';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = 'Remove this picture';
      const x = document.createElement('i');
      x.className = 'icon';
      setIcon(x, 'xmark');
      remove.append(x);
      remove.addEventListener('click', () => {
        list.splice(index, 1);
        renderAttachments();
      });
      item.append(img, remove);
      holder.append(item);
    });
    el.bubbleInput.placeholder = list.length ? 'Ask about this picture' : state.thread?.kind === 'page' ? 'Ask about this page' : 'Ask a follow-up';
    positionBubble();
  }

  function addAttachment(src) {
    const thread = state.thread;
    if (!thread || !src) return;
    thread.attachments = thread.attachments || [];
    if (thread.attachments.length >= MAX_ATTACHMENTS) {
      setStatus(`up to ${MAX_ATTACHMENTS} pictures at a time`);
      return;
    }
    thread.attachments.push(src);
    renderAttachments();
    el.bubbleInput.focus();
  }

  // Shrinks a picture to a sensible size before it is sent; big screenshots stay readable.
  async function fileToImage(file) {
    if (!file || !/^image\//.test(file.type)) return null;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // transparent screenshots get a white ground
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      return canvas.toDataURL('image/jpeg', 0.88);
    } catch {
      return null;
    }
  }

  async function attachFiles(files) {
    let added = 0;
    for (const file of Array.from(files || [])) {
      const src = await fileToImage(file);
      if (src) {
        addAttachment(src);
        added += 1;
      }
    }
    if (!added && files?.length) setStatus('that file is not a picture');
  }

  $('#bubble-upload').addEventListener('click', () => $('#bubble-file').click());
  $('#bubble-file').addEventListener('change', (event) => {
    attachFiles(event.target.files);
    event.target.value = '';
  });
  // Paste a screenshot straight into the question box.
  el.bubbleInput.addEventListener('paste', (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => /^image\//.test(file.type));
    if (!files.length) return;
    event.preventDefault();
    attachFiles(files);
  });
  // Or drop one on the note.
  el.bubble.addEventListener('dragover', (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    el.bubble.classList.add('dropping');
  });
  el.bubble.addEventListener('dragleave', () => el.bubble.classList.remove('dropping'));
  el.bubble.addEventListener('drop', (event) => {
    event.preventDefault();
    el.bubble.classList.remove('dropping');
    attachFiles(event.dataTransfer?.files);
  });
  // Snip part of the page into this note instead of starting a new one.
  $('#bubble-snip').addEventListener('click', () => startSnip({ attach: true }));

  async function attachRegion(rect) {
    if (!rect || rect.width < 12 || rect.height < 12 || !state.viewReady) return;
    try {
      addAttachment(await api.capture(el.view.getWebContentsId(), rect));
    } catch {
      setStatus('that snip did not work, try again');
    }
  }
  function autoGrow() {
    el.bubbleInput.style.height = 'auto';
    el.bubbleInput.style.height = `${clamp(el.bubbleInput.scrollHeight, 30, 96)}px`;
  }
  el.bubbleInput.addEventListener('input', () => {
    autoGrow();
    positionBubble();
  });
  el.bubbleInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      el.bubbleForm.requestSubmit();
    }
  });
  el.bubbleClose.addEventListener('click', () => closeThread());
  el.bubbleRemove.addEventListener('click', () => closeThread({ dismiss: true }));
  el.bubbleCopy.addEventListener('click', async () => {
    const answer = [...(state.thread?.turns || [])].reverse().find((turn) => turn.role === 'assistant' && turn.content);
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer.content);
      setStatus('copied');
      setTimeout(() => {
        if (el.bubbleStatus.textContent === 'copied') setStatus('');
      }, 1400);
    } catch { /* clipboard unavailable */ }
  });
  // Links inside an answer open in the page view.
  el.bubbleBody.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href');
    if (/^https?:\/\//i.test(href)) go(href);
  });

  // Drag the bubble by its header to park it anywhere.
  el.bubbleHead.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const thread = state.thread;
    if (!thread?.box) return;
    const start = { x: event.clientX, y: event.clientY, bx: thread.box.x, by: thread.box.y };
    el.bubbleHead.setPointerCapture(event.pointerId);
    const onMove = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!thread.detached && Math.hypot(dx, dy) < 4) return;
      thread.detached = { x: start.bx + dx, y: start.by + dy };
      positionBubble();
    };
    const onUp = () => {
      el.bubbleHead.removeEventListener('pointermove', onMove);
      el.bubbleHead.removeEventListener('pointerup', onUp);
      el.bubbleHead.removeEventListener('pointercancel', onUp);
    };
    el.bubbleHead.addEventListener('pointermove', onMove);
    el.bubbleHead.addEventListener('pointerup', onUp);
    el.bubbleHead.addEventListener('pointercancel', onUp);
  });

  // Places the bubble next to what it explains and keeps it on screen as the page scrolls.
  function positionBubble() {
    const thread = state.thread;
    if (!thread || el.bubble.hidden) return;
    const { w, h } = stageSize();
    const width = el.bubble.offsetWidth;
    let side = 'none';
    let x;
    let y;
    let maxHeight = Math.min(560, h - 24);

    if (thread.detached) {
      el.bubble.style.maxHeight = `${maxHeight}px`;
      const height = el.bubble.offsetHeight;
      x = clamp(thread.detached.x, 8, w - width - 8);
      y = clamp(thread.detached.y, 8, h - height - 8);
    } else if (thread.kind === 'page' || !thread.rect) {
      const home = homePosition();
      maxHeight = Math.min(560, Math.max(240, home.y - 20));
      el.bubble.style.maxHeight = `${maxHeight}px`;
      const height = el.bubble.offsetHeight;
      x = clamp(home.x + MASCOT_SIZE - width, 8, w - width - 8);
      y = clamp(home.y - height - 10, 8, h - height - 8);
    } else {
      const rect = thread.rect;
      const top = rect.y;
      const bottom = rect.y + rect.height;
      const spaceBelow = h - bottom - BUBBLE_GAP - 12;
      const spaceAbove = top - BUBBLE_GAP - 12;
      const offscreen = bottom < 0 || top > h;
      const centre = rect.x + rect.width / 2;
      const locked = thread.lockSide === 'below' && spaceBelow >= 220;
      // Too tall to fit a bubble above or below (a big picture, a long passage): stand beside it.
      const beside = !offscreen && !locked && Math.max(spaceBelow, spaceAbove) < 340;
      if (!offscreen && !beside) side = locked || spaceBelow >= 380 || spaceBelow >= spaceAbove ? 'below' : 'above';
      if (offscreen) maxHeight = Math.min(420, h - 24);
      else if (beside) maxHeight = Math.min(560, h - 24);
      else maxHeight = Math.min(560, Math.max(220, side === 'below' ? spaceBelow : spaceAbove));
      el.bubble.style.maxHeight = `${maxHeight}px`;
      const height = el.bubble.offsetHeight;
      if (beside) {
        const roomRight = w - (rect.x + rect.width);
        if (roomRight >= rect.x) x = Math.min(rect.x + rect.width + BUBBLE_GAP, w - width - 12);
        else x = Math.max(rect.x - BUBBLE_GAP - width, 44);
        y = top + rect.height / 2 - height / 2;
      } else {
        x = clamp(centre - width / 2, 44, w - width - 12);
        if (offscreen) y = bottom < 0 ? 12 : h - height - 12;
        else if (side === 'below') y = bottom + BUBBLE_GAP;
        else y = top - BUBBLE_GAP - height;
      }
      y = clamp(y, 8, h - height - 8);
      // The tail only makes sense while it can actually point at the highlight.
      const tailX = clamp(centre - x, 26, width - 26);
      const touching = side === 'below' ? Math.abs(y - (bottom + BUBBLE_GAP)) < 2 : Math.abs(y + height - (top - BUBBLE_GAP)) < 2;
      if (side !== 'none' && (!touching || Math.abs(tailX - (centre - x)) > 1)) side = 'none';
      el.bubble.style.setProperty('--tail-x', `${Math.round(tailX)}px`);

      if (thread.kind === 'region') {
        place(el.regionOutline, rect.x - 2, rect.y - 2);
        el.regionOutline.style.width = `${Math.round(rect.width + 4)}px`;
        el.regionOutline.style.height = `${Math.round(rect.height + 4)}px`;
      }
    }

    el.bubble.dataset.side = side;
    place(el.bubble, x, y);
    thread.box = { x, y, width, height: el.bubble.offsetHeight };
    updateMascot();
    // If the note moved (the page scrolled, the answer grew), keep the answer pill with its words.
    if (!$('#reply-pill').hidden) showReplyPill();
  }

  // ---------- snip ----------
  // With { attach: true } the snip is added to the open note; otherwise it starts a new one.
  let snipIntoNote = false;
  function startSnip({ attach = false } = {}) {
    if (state.home || !state.hasPage) return;
    snipIntoNote = attach && Boolean(state.thread);
    state.snipping = true;
    hidePill();
    hideTip();
    // The note steps aside so the whole page can be seen while choosing.
    if (snipIntoNote) el.bubble.style.visibility = 'hidden';
    el.snip.hidden = false;
    el.snip.classList.remove('drawing');
    el.snipBox.hidden = true;
    el.snipBtn.classList.add('active');
  }
  function cancelSnip() {
    state.snipping = false;
    el.snip.hidden = true;
    el.snipBtn.classList.remove('active');
    el.bubble.style.visibility = '';
  }
  el.snipBtn.addEventListener('click', () => (state.snipping ? cancelSnip() : startSnip()));
  el.askBtn.addEventListener('click', () => (state.thread?.kind === 'page' ? closeThread() : startPageThread()));

  el.snip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const bounds = el.stage.getBoundingClientRect();
    const origin = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    let rect = null;
    el.snip.setPointerCapture(event.pointerId);
    el.snip.classList.add('drawing');
    const onMove = (e) => {
      const x = clamp(e.clientX - bounds.left, 0, bounds.width);
      const y = clamp(e.clientY - bounds.top, 0, bounds.height);
      rect = { x: Math.min(origin.x, x), y: Math.min(origin.y, y), width: Math.abs(x - origin.x), height: Math.abs(y - origin.y) };
      el.snipBox.hidden = false;
      place(el.snipBox, rect.x, rect.y);
      el.snipBox.style.width = `${rect.width}px`;
      el.snipBox.style.height = `${rect.height}px`;
    };
    const onUp = () => {
      el.snip.removeEventListener('pointermove', onMove);
      el.snip.removeEventListener('pointerup', onUp);
      el.snip.removeEventListener('pointercancel', onUp);
      const intoNote = snipIntoNote && Boolean(state.thread);
      cancelSnip();
      if (!rect) return;
      if (intoNote) attachRegion(rect);
      else startRegionThread(rect);
    };
    el.snip.addEventListener('pointermove', onMove);
    el.snip.addEventListener('pointerup', onUp);
    el.snip.addEventListener('pointercancel', onUp);
  });

  // ---------- keyboard and menu commands ----------
  function onEscape() {
    if (!el.keygate.hidden) hideKeyGate();
    else if (state.snipping) cancelSnip();
    else if (!el.notesPanel.hidden) el.notesPanel.hidden = true;
    else if (state.thread) closeThread();
    else if (!el.pill.hidden) {
      toPage({ type: 'clear-selection' });
      hidePill();
    }
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') onEscape();
  });

  function setZoom(next) {
    state.zoom = clamp(Math.round(next * 100) / 100, 0.5, 2.5);
    try {
      el.view.setZoomFactor(state.zoom);
    } catch { /* not ready */ }
  }

  el.tabNew.addEventListener('click', () => newTab());
  // Links that ask for a new window open in a new tab, but only when the request comes from
  // the tab on screen, not in bursts, and not without limit. A page in the background, or
  // one calling window.open in a loop, gets nothing.
  const MAX_TABS = 20;
  let lastOpenedAt = 0;
  api.onOpenTab((url, sourceId) => {
    let activeId = -1;
    try {
      activeId = el.view.getWebContentsId();
    } catch { /* view not ready */ }
    if (sourceId !== activeId || tabs.length >= MAX_TABS || Date.now() - lastOpenedAt < 600) return;
    lastOpenedAt = Date.now();
    newTab(url);
  });

  api.onCommand((name) => {
    const numbered = /^tab-(\d)$/.exec(name);
    if (numbered) {
      const wanted = Number(numbered[1]) === 9 ? tabs[tabs.length - 1] : tabs[Number(numbered[1]) - 1];
      if (wanted) switchTab(wanted);
      return;
    }
    switch (name) {
      case 'new-tab':
        newTab();
        break;
      case 'close-tab':
        closeTab(tab);
        break;
      case 'next-tab':
        stepTab(1);
        break;
      case 'prev-tab':
        stepTab(-1);
        break;
      case 'focus-url':
        (state.home ? el.homeUrl : el.url).focus();
        break;
      case 'home':
        setHome(true);
        break;
      case 'back':
        if (!el.back.disabled) el.view.goBack();
        break;
      case 'forward':
        if (!el.forward.disabled) el.view.goForward();
        break;
      case 'reload':
        if (state.hasPage) el.view.reload();
        break;
      case 'zoom-in':
        setZoom(state.zoom + 0.1);
        break;
      case 'zoom-out':
        setZoom(state.zoom - 0.1);
        break;
      case 'zoom-reset':
        setZoom(1);
        break;
      case 'explain':
        if (state.live) startSelectionThread('explain');
        break;
      case 'snip':
        if (state.snipping) cancelSnip();
        else startSnip();
        break;
      case 'ask-page':
        startPageThread();
        break;
      default:
    }
  });

  window.addEventListener('resize', () => {
    positionPill();
    positionBubble();
    updateMascot(true);
  });

  // ---------- start ----------
  const NOTICE_CODE = /(NEBIUS_[A-Z_]+=?)/g;
  function showModelNotice(model) {
    $('.home-notice')?.remove();
    // A missing or rejected key has its own pop-up and toolbar button; the home screen stays clean.
    if (model.ok || model.error === 'missing-key' || model.error === 'bad-key') return;
    const messages = {
      'missing-key': 'Explanations are off until you add an API key. Open the settings file, paste your Nebius Token Factory key after NEBIUS_API_KEY= and save it, then choose Check again.',
      'bad-key': 'Token Factory rejected the API key. Open the settings file, check the value after NEBIUS_API_KEY= and save it, then choose Check again.',
      'model-not-found': `The model "${model.id}" is not in the live Token Factory catalog. Set NEBIUS_MODEL= in the settings file to a current model ID, or leave it empty for the default.`,
      'catalog-unreachable': 'Could not reach Token Factory to check the model. Browsing works; explanations need a connection.',
    };
    const notice = document.createElement('div');
    notice.className = 'home-notice';
    const message = messages[model.error] || `Token Factory answered with an error (${model.error}). Explanations may not work.`;
    for (const part of message.split(NOTICE_CODE)) {
      if (NOTICE_CODE.test(part)) {
        const code = document.createElement('code');
        code.textContent = part;
        notice.append(code);
      } else if (part) {
        notice.append(part);
      }
      NOTICE_CODE.lastIndex = 0;
    }
    const actions = document.createElement('div');
    actions.className = 'notice-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-primary';
    open.textContent = 'Open settings file';
    open.addEventListener('click', () => api.openSettings());
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn btn-quiet';
    again.textContent = 'Check again';
    again.addEventListener('click', async () => {
      again.disabled = true;
      again.textContent = 'Checking';
      await loadConfig();
    });
    actions.append(open, again);
    notice.append(actions);
    $('#home-status').append(notice);
  }


  // Reads settings and the live model catalog; safe to call again after the settings file changes.
  async function loadConfig() {
    state.config = await api.getConfig();
    setMascotKey(state.config.mascot || state.mascotKey || 'quippy');
    showModelNotice(state.config.model);
    el.keyBtn.hidden = !needsKey();
    showModel();
    return state.config;
  }

  // The line at the foot of a note: which model answered there, or, before any answer,
  // which model the next question will go to. Hover shows the full model ID.
  function showModel() {
    const answered = state.thread?.model;
    const configured = state.config?.model;
    const name = answered?.name || (configured?.ok ? configured.name : '');
    el.bubbleFoot.textContent = name ? `${name} on Nebius Token Factory` : 'Nebius Token Factory';
    el.bubbleFoot.title = answered?.id || (configured?.ok ? configured.id : '');
  }

  // Coming back to the window re-reads the settings, so a model or key changed in the
  // settings file shows up without restarting.
  let configCheckedAt = Date.now();
  window.addEventListener('focus', () => {
    if (Date.now() - configCheckedAt < 15000 || !el.keygate.hidden) return;
    configCheckedAt = Date.now();
    loadConfig();
  });

  // ---------- the "add your key" pop-up ----------
  // Explanations cannot work without a key, so this is shown at launch and again whenever
  // one is asked for. The key itself never passes through this window: the background
  // process reads it from the clipboard or the settings file.
  const needsKey = () => ['missing-key', 'bad-key'].includes(state.config?.model?.error);

  function showKeyGate(message = '') {
    $('#keygate-mascot').innerHTML = window.Mascots.svg(state.mascotKey);
    el.keygateStatus.textContent = message || (state.config?.model?.error === 'bad-key' ? 'Token Factory rejected the key that is saved. Add a new one.' : '');
    el.keygate.hidden = false;
    $('#keygate-paste').focus();
  }
  function hideKeyGate() {
    el.keygate.hidden = true;
  }

  const KEY_PROBLEMS = {
    'empty': 'Nothing is copied yet. Copy your key on the Token Factory site, then press the button again.',
    'not-a-key': 'What is copied does not look like an API key. Copy just the key, with nothing around it.',
    'rejected': 'Token Factory did not accept that key. Check you copied all of it, or create a new one.',
    'unreachable': 'Could not reach Token Factory to check the key. Check your connection and try again.',
  };
  $('#keygate-paste').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    el.keygateStatus.textContent = 'Checking the key with Token Factory';
    const result = await api.useCopiedKey();
    button.disabled = false;
    if (!result.ok) {
      el.keygateStatus.textContent = KEY_PROBLEMS[result.reason] || 'That did not work. Try again.';
      return;
    }
    await loadConfig();
    if (needsKey()) {
      el.keygateStatus.textContent = KEY_PROBLEMS.rejected;
      return;
    }
    hideKeyGate();
    setMascotState('happy', 1200);
  });
  $('#keygate-file').addEventListener('click', () => {
    api.openSettings();
    el.keygateStatus.textContent = 'Paste your key after NEBIUS_API_KEY= in that file and save it. This window notices on its own.';
    // Poll quietly while the file is being edited, so saving it is all that is needed.
    const started = Date.now();
    const timer = setInterval(async () => {
      if (el.keygate.hidden || Date.now() - started > 5 * 60 * 1000) {
        clearInterval(timer);
        return;
      }
      await loadConfig();
      if (!needsKey()) {
        clearInterval(timer);
        hideKeyGate();
        setMascotState('happy', 1200);
      }
    }, 2500);
  });
  $('#keygate-get').addEventListener('click', () => api.openTokenFactory());
  $('#keygate-later').addEventListener('click', hideKeyGate);
  el.keyBtn.addEventListener('click', () => showKeyGate());

  async function init() {
    try {
      const saved = JSON.parse(localStorage.getItem('mascot-home') || 'null');
      if (saved && Number.isFinite(saved.right) && Number.isFinite(saved.bottom)) state.homeOffset = saved;
    } catch { /* ignore */ }

    renderPicker();
    renderTabs();
    setMascotKey('quippy');
    updateMascot(true);
    document.body.classList.add('home-on');

    await loadConfig();
    state.recent = state.config.recent || [];
    renderNotes();
    renderRecent();
    if (needsKey()) showKeyGate();

    if (state.config.startUrl) go(state.config.startUrl);
    else el.homeUrl.focus();
  }

  init();
})();
