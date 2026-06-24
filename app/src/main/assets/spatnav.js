/*
 * Seerr TV spatial navigation.
 * D-pad focus navigation for the Jellyseerr/Seerr web UI on a TV remote (no mouse).
 * Only a curated allowlist of elements is selectable (so navigation never lands on
 * decorative/stray clickables); inside modals/menus it falls back to all focusables.
 * Native calls window.__seerrNav('up'|'down'|'left'|'right'|'enter'|'pick'|'back'
 * |'whereami'|'focusSidebar'|'search'). Moves are instant/synchronous so rapid
 * presses each register. 'enter'/'search' return 'input' when a text field was
 * focused so the native code can raise the on-screen keyboard.
 *
 * The focus highlight is a data-attribute ([data-seerrfocus]), NOT a CSS class:
 * controlled React inputs (e.g. the search box) rewrite their className on every
 * keystroke, which would silently strip a class-based highlight. React leaves unknown
 * data-attributes alone, so the highlight survives re-renders.
 */
(function () {
  if (window.__seerrNavInstalled) { try { window.__seerrNav('pick'); } catch (e) {} return; }
  window.__seerrNavInstalled = true;

  // Exactly the things that should be selectable while browsing.
  var ALLOW = [
    'a.slider-title',                            // "see more" section headers
    '.sidebar a[href]',                          // sidebar nav items
    '#search_field',                             // search box
    '.media-actions button:not([disabled])',     // detail-page action buttons
    '.media-actions a[href]',                    // detail-page action links (Play, etc.)
    '[data-testid="title-card"] [role="link"]',  // movie/tv poster cards
    'a[role="link"][href]',                      // person / studio / network / genre cards
    '[data-testid="user-menu"]',                 // profile/avatar menu
    'select:not([disabled])',                    // filter / sort / page-size / season dropdowns
    'a[href^="/movie/"]:has(img)',               // request-row + recent-request poster links
    'a[href^="/tv/"]:has(img)'                   // request-row + recent-request poster links
  ].join(',');

  // Extra selectables on paginated list/management pages (Requests, Users, Issues):
  // every real action button (Delete/Remove/Approve/Decline/Edit, sort-direction,
  // pagination). Buttons are noisy on browse pages, so only widen the net here.
  var LISTEXTRA = 'button:not([disabled])';

  // Broad focusable set used inside modals/menus and as a fallback (login, settings).
  var BROAD =
    'a[href],button:not([disabled]),input:not([type="hidden"]):not([disabled]),' +
    'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),' +
    '[role="button"],[role="link"],[role="menuitem"],[role="menuitemradio"],[role="option"],' +
    '[role="tab"],[role="switch"],[role="checkbox"],[contenteditable="true"]';

  var style = document.createElement('style');
  style.id = '__seerrNavStyle';
  // Lighter highlight: outline + a thin ring (no large blurred glow, which repainted
  // every scroll frame and stuttered on the TV box). Styled on a data-attribute so
  // React can't strip it (see file header).
  style.textContent =
    // Base highlight: outline + thin ring, with a short transition so the eye can track
    // the focus as it moves at 10 feet.
    '[data-seerrfocus]{outline:3px solid #818CF8 !important;outline-offset:2px !important;' +
    'box-shadow:0 0 0 2px rgba(129,140,248,.55),0 8px 24px rgba(0,0,0,.45) !important;' +
    'border-radius:8px !important;scroll-margin:170px !important;' +
    'transition:transform .13s ease,outline-color .13s ease,box-shadow .13s ease !important;}' +
    // Poster cards get the classic TV "lift": scale up + sit above neighbours.
    '[data-seerrfocus="card"]{transform:scale(1.07) !important;z-index:30 !important;position:relative !important;}' +
    // Press feedback: a quick dip+brighten on activation (declared last so it wins over the lift).
    '[data-seerrflash]{transform:scale(.94) !important;filter:brightness(1.3) !important;' +
    'transition:transform .06s ease,filter .06s ease !important;}' +
    // Indeterminate top loading bar shown the instant OK triggers a route change.
    '#__seerrLoad{position:fixed;top:0;left:0;right:0;height:3px;z-index:2147483646;opacity:0;' +
    'pointer-events:none;overflow:hidden;transition:opacity .12s;}' +
    '#__seerrLoad.on{opacity:1;}' +
    '#__seerrLoad.on::before{content:"";position:absolute;top:0;height:3px;width:34%;border-radius:2px;' +
    'background:#818CF8;box-shadow:0 0 10px #818CF8;animation:__seerrLoadA 1s ease-in-out infinite;}' +
    '@keyframes __seerrLoadA{0%{left:-34%;}100%{left:100%;}}' +
    '.pwa-only{display:none !important;}'; // hide the in-page back/forward buttons
  (document.head || document.documentElement).appendChild(style);

  try { var ae = document.activeElement; if (ae && /^(input|textarea)$/i.test(ae.tagName)) ae.blur(); } catch (e) {}

  var current = null;

  // ---- layout: collapsing sidebar drawer + full-width search bar -------------------
  var _sbRoot = null;
  function sidebarRoot() { if (_sbRoot && document.contains(_sbRoot)) return _sbRoot; _sbRoot = document.querySelector('.sidebar'); return _sbRoot; }
  function sidebarFixed() { var s = sidebarRoot(); return s ? s.parentElement : null; }
  function contentOffset() { return document.querySelector('[class*="ml-64"]'); }

  function ensureLayout() {
    var off = contentOffset();
    if (off && off.style.marginLeft !== '0px') { off.style.transition = 'margin-left .16s ease'; off.style.marginLeft = '0px'; }
    var bar = document.querySelector('.searchbar');
    if (bar && bar.style.left !== '0px') { bar.style.left = '0px'; } // expand search bar full-width
    var fx = sidebarFixed();
    if (fx && !fx.__seerrInit) {
      fx.__seerrInit = true;
      fx.style.transition = 'transform .16s ease';
      fx.style.willChange = 'transform';
      fx.style.transform = 'translateX(-100%)';
      fx.__expanded = false;
    }
  }

  function setSidebar(expanded) {
    ensureLayout();
    var fx = sidebarFixed();
    if (!fx || fx.__expanded === expanded) return;
    fx.__expanded = expanded;
    fx.style.transform = expanded ? 'translateX(0)' : 'translateX(-100%)';
  }

  // ---- candidate set ---------------------------------------------------------------
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return false;
    var s; try { s = getComputedStyle(el); } catch (e) { return true; }
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity || '1') === 0) return false;
    if (el.disabled) return false;
    return true;
  }

  function selectOverlay() { return document.getElementById('__seerrSelOv'); }

  function visibleOverlay() {
    var ours = selectOverlay();
    if (ours && visible(ours)) return ours;
    // .slideover = Jellyseerr's SlideOver panel (Manage request, Discover Filters) which
    // has no role=dialog; [role=listbox] = react-select / headless Listbox popups.
    var sels = ['[role="dialog"]', '[aria-modal="true"]', '[role="menu"]', '[role="listbox"]', '.slideover'];
    for (var i = 0; i < sels.length; i++) {
      var els = document.querySelectorAll(sels[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (!visible(el) || !el.querySelector(BROAD)) continue;
        // Must actually overlap the viewport — a CLOSED slideover/menu often stays in the
        // DOM translated off-screen, and confining focus to it would be a trap.
        var r = el.getBoundingClientRect();
        if (Math.min(r.right, innerWidth) - Math.max(r.left, 0) < 60) continue;
        if (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0) < 40) continue;
        return el;
      }
    }
    return null;
  }

  // Paginated list / management pages (Requests, Users, Issues) where every action
  // button should be reachable, not just the curated browse set.
  function isListPage() {
    return !!document.querySelector('nav[aria-label="Pagination"],#filter,#sort,#pageSize');
  }

  function candidates() {
    var ov = visibleOverlay();
    if (ov) return [].slice.call(ov.querySelectorAll(BROAD)).filter(visible);
    var sel = isListPage() ? (ALLOW + ',' + LISTEXTRA) : ALLOW;
    var list = [].slice.call(document.querySelectorAll(sel)).filter(visible);
    if (list.length) return list;
    return [].slice.call(document.querySelectorAll(BROAD)).filter(visible); // login/settings fallback
  }

  // ---- geometry helpers ------------------------------------------------------------
  function box(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, rr: r.right, b: r.bottom }; }
  function overlapX(a, b) { return Math.max(0, Math.min(a.rr, b.rr) - Math.max(a.l, b.l)); }
  function overlapY(a, b) { return Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t)); }
  function isSidebar(el) { var sr = sidebarRoot(); if (sr) return sr.contains(el); try { return box(el).x < innerWidth * 0.18; } catch (e) { return false; } }
  function isSearch(el) { return el && el.id === 'search_field'; }
  function searchEl() { return document.querySelector('#search_field'); }
  function isText(el) {
    var tag = el.tagName.toLowerCase();
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return true;
    if (tag === 'textarea') return true;
    if (tag === 'input') { var t = (el.getAttribute('type') || 'text').toLowerCase(); return ['text', 'email', 'password', 'search', 'url', 'tel', 'number', ''].indexOf(t) !== -1; }
    return false;
  }
  function scrollTop() { return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0; }

  function hover(el, enter) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    try { el.dispatchEvent(new PointerEvent(enter ? 'pointerover' : 'pointerout', o)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent(enter ? 'mouseover' : 'mouseout', o)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent(enter ? 'pointerenter' : 'pointerleave', o)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent(enter ? 'mouseenter' : 'mouseleave', o)); } catch (e) {}
  }

  function mark(el) { if (el) { try { el.setAttribute('data-seerrfocus', isCard(el) ? 'card' : '1'); } catch (e) {} } }
  function unmark(el) { if (el) { try { el.removeAttribute('data-seerrfocus'); } catch (e) {} } }

  // Quick press feedback on activation.
  function flash(el) {
    if (!el) return;
    try { el.setAttribute('data-seerrflash', '1'); setTimeout(function () { try { el.removeAttribute('data-seerrflash'); } catch (e) {} }, 150); } catch (e) {}
  }

  // Instant "something is loading" affordance the moment OK triggers a route change, since
  // client-side navigation never fires the native progress bar and the detail page renders
  // for ~1s. Removed when the new page settles (or a safety timeout).
  function showLoading() {
    var b = document.getElementById('__seerrLoad');
    if (!b) { b = document.createElement('div'); b.id = '__seerrLoad'; (document.body || document.documentElement).appendChild(b); }
    b.className = 'on';
    clearTimeout(window.__seerrLoadT);
    window.__seerrLoadT = setTimeout(hideLoading, 4000);
  }
  function hideLoading() {
    var b = document.getElementById('__seerrLoad');
    if (b) b.className = '';
    clearTimeout(window.__seerrLoadT);
  }

  function setFocus(el) {
    if (current && current !== el) { unmark(current); hover(current, false); }
    current = el;
    if (!el) return;
    mark(el);
    hover(el, true);
    if (!isText(el)) { try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} } }
    setSidebar(isSidebar(el));
    // Inside a modal/menu, scroll the OVERLAY's own scroll container (so a tall request
    // modal's OK button can be reached) but NEVER the page behind it. Otherwise scroll the
    // page to keep the focused element in view.
    var ov = el.closest && el.closest('[role="dialog"],[role="menu"],[aria-modal="true"],[role="listbox"],.slideover,#__seerrSelOv');
    if (ov) { scrollIntoOverlay(el, ov); }
    else { try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
    schedulePrefetch(el);
  }

  // Bring el into view within the overlay's nearest scrollable ancestor, without scrolling
  // the page behind the modal.
  function scrollIntoOverlay(el, ov) {
    try {
      var p = el.parentElement;
      while (p && p !== document.body) {
        var s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 2) {
          var er = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
          if (er.top < pr.top + 12) p.scrollTop -= (pr.top + 12 - er.top);
          else if (er.bottom > pr.bottom - 12) p.scrollTop += (er.bottom - (pr.bottom - 12));
          return;
        }
        if (p === ov) break;
        p = p.parentElement;
      }
    } catch (e) {}
  }

  // When focus settles on a card/link, ask Next.js to prefetch its route so opening it is
  // a little quicker (loads the page chunk ahead of the OK press). Debounced so we only
  // prefetch what the user pauses on, not every item swept past.
  function schedulePrefetch(el) {
    clearTimeout(window.__seerrPf);
    window.__seerrPf = setTimeout(function () {
      try {
        var url = isCard(el) ? cardUrl(el) : null;
        if (!url) { var lk = cardLink(el); if (lk) { var h = lk.getAttribute('href'); if (h && h.charAt(0) === '/') url = h; } }
        if (url && window.next && window.next.router && window.next.router.prefetch) window.next.router.prefetch(url);
      } catch (e) {}
    }, 220);
  }

  function pick() {
    ensureLayout();
    var c = candidates();
    if (!c.length) return null;
    // Already on a valid candidate -> keep it, but re-assert the highlight in case a
    // re-render stripped it.
    if (current && c.indexOf(current) !== -1 && visible(current)) { mark(current); return current; }
    // Detail page: land on the primary action (Request / Play / Manage) instead of a
    // star/trailer icon or a center card. Prefer by label, else the widest action.
    var ma = document.querySelector('.media-actions');
    if (ma) {
      var acts = [].slice.call(ma.querySelectorAll('button:not([disabled]),a[href]')).filter(visible);
      if (acts.length) {
        var prim = acts.filter(function (a) { return /request|play on|^play\b|available|manage|view request|watch now/i.test((a.textContent || '').trim()); })[0];
        if (!prim) { acts.sort(function (a, b) { return (box(b).rr - box(b).l) - (box(a).rr - box(a).l); }); prim = acts[0]; }
        setFocus(prim); return prim;
      }
    }
    // On browse pages (poster cards present) keep text fields out of the initial pick so
    // we don't land on the search box; on form pages (login/settings) a field is exactly
    // what should be focused first.
    var hasCards = c.some(function (el) { return el.getAttribute && (el.getAttribute('role') === 'link' || (el.closest && el.closest('[data-testid="title-card"]'))); });
    var cx = innerWidth / 2, cy = innerHeight / 2.4;
    c.sort(function (a, b) {
      var da = Math.hypot(box(a).x - cx, box(a).y - cy) + (hasCards && isText(a) ? 1e6 : 0) + (isSidebar(a) ? 5e5 : 0);
      var db = Math.hypot(box(b).x - cx, box(b).y - cy) + (hasCards && isText(b) ? 1e6 : 0) + (isSidebar(b) ? 5e5 : 0);
      return da - db;
    });
    setFocus(c[0]);
    return c[0];
  }

  function findBest(dir, c, from) {
    var best = null, bestScore = Infinity;
    for (var i = 0; i < c.length; i++) {
      var el = c[i]; if (el === current) continue;
      var to = box(el);
      var dx = to.x - from.x, dy = to.y - from.y, primary, secondary, ov;
      if (dir === 'left') { if (dx >= -3) continue; primary = -dx; secondary = Math.abs(dy); ov = overlapY(from, to); }
      else if (dir === 'right') { if (dx <= 3) continue; primary = dx; secondary = Math.abs(dy); ov = overlapY(from, to); }
      else if (dir === 'up') { if (dy >= -3) continue; primary = -dy; secondary = Math.abs(dx); ov = overlapX(from, to); }
      else { if (dy <= 3) continue; primary = dy; secondary = Math.abs(dx); ov = overlapX(from, to); }
      var score = primary + secondary * 2.2;
      if (ov > 0) score -= Math.min(primary, 240) * 0.6;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  // Row-by-row navigation: land on the FURTHEST-LEFT item of the nearest row. Used for
  // the full-width search bar (so down-from-search hits the leftmost item, not the
  // centered one) and for list/management pages (Requests etc.), whose rows have a tiny
  // far-left target (the poster) that findBest's column-alignment would otherwise skip
  // in favour of a closer centered control. Left/right still move within a row.
  function firstInRow(dir, pool, from) {
    var items = pool.filter(function (el) {
      if (el === current) return false;
      var b = box(el);
      return dir === 'down' ? (b.t > from.b - 6) : (b.b < from.t + 6);
    });
    if (!items.length) return null;
    items.sort(function (a, b) { return dir === 'down' ? (box(a).t - box(b).t) : (box(b).b - box(a).b); });
    var first = box(items[0]);
    var edge = dir === 'down' ? first.t : first.b;                 // nearest row's leading edge
    var tol = Math.min((first.b - first.t) * 0.5 + 10, 44);        // capped so a far row can't merge in
    var row = items.filter(function (el) { var b = box(el); var e = dir === 'down' ? b.t : b.b; return Math.abs(e - edge) <= tol; });
    row.sort(function (a, b) { return box(a).l - box(b).l; });
    return row[0];
  }

  function sidebarItems() { var sr = sidebarRoot(); if (!sr) return []; return candidates().filter(function (el) { return sr.contains(el); }); }

  function focusSidebarFirst() {
    setSidebar(true);
    var items = sidebarItems().filter(function (el) { return (el.textContent || '').trim().length > 0; });
    items.sort(function (a, b) { return box(a).y - box(b).y; });
    if (items.length) { setFocus(items[0]); return 'sidebar'; }
    return 'none';
  }

  function move(dir) {
    ensureLayout();
    var c = candidates();
    if (!c.length) { focusSidebarFirst(); return; } // empty page (no results) -> give an escape via the sidebar
    if (!current || c.indexOf(current) === -1 || !visible(current)) { pick(); return; }

    // Confined to a modal/menu (profile dropdown, request modal): move only among its
    // items. Never scroll the page or open the sidebar — at an edge, just stay put so the
    // main view behind it stays in stasis.
    var ov = visibleOverlay();
    if (ov && ov.contains(current)) {
      var b = findBest(dir, c, box(current));
      if (b) setFocus(b);
      return;
    }

    if (isSidebar(current)) {
      if (dir === 'right') {
        var content = c.filter(function (el) { return !isSidebar(el); });
        var b = content.length ? findBest('right', content, box(current)) : null;
        if (b) { setFocus(b); return; }
      }
      var bs = findBest(dir, sidebarItems(), box(current));
      if (bs) setFocus(bs);
      return;
    }

    var contentCands = c.filter(function (el) { return !isSidebar(el); });
    if (dir === 'left') {
      var bl = findBest('left', contentCands, box(current));
      if (bl) { setFocus(bl); return; }
      focusSidebarFirst();
      return;
    }
    if (dir === 'right') {
      var br = findBest('right', contentCands, box(current));
      if (br) setFocus(br); else flash(current); // dead-stop at row end -> visible nudge
      return;
    }

    // up / down. The search bar is a last resort when going up: only land on it at
    // the very top of the page when there is no item above.
    var pool = (dir === 'up') ? contentCands.filter(function (el) { return !isSearch(el); }) : contentCands;
    // Row-by-row between rows: the search bar, list pages, AND home sliders (each slider is
    // one horizontal row — up/down should jump to the leftmost/first card of the adjacent
    // slider, not a column-aligned card in a differently-scrolled slider). Grids (discover/
    // search results) are NOT media-sliders, so they keep column-aligned findBest.
    var inSlider = current.closest && current.closest('[data-testid="media-slider"]');
    if (isSearch(current) || isListPage() || inSlider) {
      var fr = firstInRow(dir, pool, box(current));
      if (fr) { setFocus(fr); return; }
    }
    var best = findBest(dir, pool, box(current));
    if (best) { setFocus(best); return; }

    if (dir === 'up') {
      if (scrollTop() > 4) {
        scrollBy(0, -innerHeight * 0.85);
        var a2 = (current && visible(current)) ? findBest('up', candidates().filter(function (el) { return !isSidebar(el) && !isSearch(el); }), box(current)) : null;
        if (a2) { setFocus(a2); return; }
      }
      var s = searchEl();
      if (s && visible(s)) { setFocus(s); return; }
      flash(current); // top edge -> nudge
      return;
    }

    // down edge: scroll and grab the next item.
    var beforeY = scrollTop();
    scrollBy(0, innerHeight * 0.85);
    var after = (current && visible(current)) ? findBest('down', candidates().filter(function (el) { return !isSidebar(el); }), box(current)) : null;
    if (after) setFocus(after);
    else if (!current || !visible(current)) pick();
    else if (scrollTop() === beforeY) flash(current); // truly at the bottom, nothing scrolled -> nudge
  }

  // ---- activation ------------------------------------------------------------------
  function clickEl(el) {
    if (!el) return;
    flash(current || el);
    var r = el.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      el.dispatchEvent(new PointerEvent('pointerup', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.dispatchEvent(new MouseEvent('click', o));
    } catch (e) { try { el.click(); } catch (e2) {} }
  }

  function cardLink(el) {
    if (el.matches && el.matches('a[href]')) return el;
    var inner = el.querySelector && el.querySelector('a[href]');
    if (inner) return inner;
    return (el.closest && el.closest('a[href]')) || null;
  }
  function isCard(el) { return (el.getAttribute && el.getAttribute('role') === 'link') || (el.closest && !!el.closest('[data-testid="title-card"]')); }
  function reactFiber(n) { for (var k in n) { if (k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0) return n[k]; } return null; }
  function cardUrl(el) {
    var f = reactFiber(el), d = 0;
    while (f && d < 30) { var p = f.memoizedProps; if (p && p.id != null) { var mt = p.mediaType || p.type; if (mt === 'movie' || mt === 'tv') return '/' + mt + '/' + p.id; } f = f.return; d++; }
    return null;
  }

  // ---- native <select> replaced with a D-pad-friendly overlay ----------------------
  // Synthetic clicks don't reliably open the WebView's native picker, and the picker
  // isn't great with a remote anyway. We render our own option list (a role="dialog"
  // so the normal overlay navigation confines focus to it) and write the chosen value
  // back through the value setter so onChange handlers fire.
  function setNativeValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, value); else el.value = value;
  }

  function closeSelectOverlay() {
    var ov = selectOverlay();
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  // Restore focus to the <select> that opened the overlay. React often re-renders the
  // toolbar after a value change, so re-resolve the live node by id rather than trusting
  // the original reference.
  function restoreSelectFocus() {
    var live = window.__seerrSelId ? document.getElementById(window.__seerrSelId) : null;
    if (!live && window.__seerrSelEl && document.contains(window.__seerrSelEl)) live = window.__seerrSelEl;
    if (live && visible(live)) setFocus(live); else pick();
  }
  // Changing a filter/sort re-renders the toolbar (the <select> node is replaced), and the
  // mutation re-pick (~250ms) would otherwise steal focus. Re-assert across that window.
  function restoreSelectFocusRetry() {
    restoreSelectFocus();
    setTimeout(restoreSelectFocus, 120);
    setTimeout(restoreSelectFocus, 340);
  }

  function openSelect(sel) {
    closeSelectOverlay();
    window.__seerrSelEl = sel;
    window.__seerrSelId = sel.id || '';
    var ov = document.createElement('div');
    ov.id = '__seerrSelOv';
    ov.setAttribute('role', 'dialog');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(0,0,0,.65);';
    var bx = document.createElement('div');
    bx.style.cssText = 'min-width:300px;max-width:80vw;max-height:72vh;overflow:auto;padding:8px;' +
      'background:#1f2937;border:1px solid #4b5563;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.6);';
    var opts = sel.options;
    for (var i = 0; i < opts.length; i++) {
      (function (opt) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = opt.label || opt.text || opt.value;
        b.style.cssText = 'display:block;width:100%;text-align:left;padding:13px 18px;margin:2px 0;' +
          'font-size:16px;color:#e5e7eb;border:0;border-radius:9px;cursor:pointer;' +
          'background:' + (opt.selected ? '#4f46e5' : 'transparent') + ';';
        b.addEventListener('click', function () {
          if (sel.value !== opt.value) {
            setNativeValue(sel, opt.value);
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
          closeSelectOverlay();
          restoreSelectFocusRetry(); // survive React's post-change re-render
        });
        bx.appendChild(b);
      })(opts[i]);
    }
    ov.appendChild(bx);
    document.body.appendChild(ov);
    var btns = bx.querySelectorAll('button');
    var idx = sel.selectedIndex < 0 ? 0 : sel.selectedIndex;
    setFocus(btns[idx] || btns[0]);
  }

  // Navigate via Next.js' client-side router when possible: no full page reload, so it's
  // instant, keeps the app/data cached for fast back-out, and avoids the mobile->desktop
  // viewport reflow flash a hard load causes. Falls back to a hard nav if next/router
  // isn't reachable.
  // After a route change the new page renders for a while (heavy detail pages); suppress
  // the per-frame layout/observer work during that burst so it doesn't add to the render
  // time, and re-pick once it settles.
  var navQuietUntil = 0;
  function markNav() { try { navQuietUntil = Date.now() + 2500; } catch (e) {} }

  // Remember, per forward navigation, which item was opened and where the page was scrolled
  // so BACK can return focus there instead of re-picking a random element and scroll-jumping
  // (which made backing out feel like the whole layout rebuilt).
  var navStack = [];
  function spaPush(url) {
    try {
      if (window.next && window.next.router && window.next.router.push) {
        navStack.push(url); if (navStack.length > 30) navStack.shift();
        markNav(); showLoading();
        window.next.router.push(url);
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Find a focusable card/link that points at url (matches the card's React-fiber URL or an
  // <a href>). Used to restore focus to the exact item you opened, after BACK.
  function findByUrl(url) {
    if (!url) return null;
    var c = candidates();
    for (var i = 0; i < c.length; i++) {
      var el = c[i];
      if (isCard(el) && cardUrl(el) === url) return el;
      var lk = cardLink(el);
      if (lk && lk.getAttribute('href') === url) return el;
    }
    return null;
  }

  function activate() {
    if (!current) { pick(); return 'pick'; }
    var el = current;
    if (el.tagName === 'SELECT') { openSelect(el); return 'select'; }
    if (isText(el)) { try { el.focus(); } catch (e) {} return 'input'; }
    // Resolve an internal URL (poster card via React fiber, or an <a href> on/under the
    // element) and route client-side.
    var url = isCard(el) ? cardUrl(el) : null;
    if (!url) { var lk = cardLink(el); if (lk) { var h = lk.getAttribute('href'); if (h && h.charAt(0) === '/') url = h; } }
    if (url) { flash(el); if (!spaPush(url)) { try { location.assign(url); } catch (e) { location.href = url; } } return 'click'; }
    clickEl(cardLink(el) || el);
    return 'click';
  }

  function focusSearch() {
    var s = searchEl();
    if (!s) return 'none';
    setFocus(s);
    try { s.focus(); } catch (e) {}
    return 'input';
  }

  function whereami() { if (!current || !visible(current)) return 'none'; return isSidebar(current) ? 'sidebar' : 'content'; }

  function doBack() {
    // Close our own select overlay first (BACK should dismiss it, not the page).
    if (selectOverlay()) { closeSelectOverlay(); restoreSelectFocus(); return 'goback'; }
    // A native modal/menu (profile dropdown, request modal) is open -> close it (Escape)
    // and return focus to whatever opened it, instead of navigating back a page.
    var ov = visibleOverlay();
    if (ov) {
      var esc = function (t) { try { t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true })); } catch (e) {} };
      esc(document); esc(current || document.body);
      var prev = window.__seerrPreOverlay;
      setTimeout(function () {
        if (prev && document.contains(prev) && visible(prev)) setFocus(prev); else pick();
      }, 70);
      return 'goback';
    }
    if (current && isSidebar(current)) return 'exit';
    var path = location.pathname || '/';
    if (path !== '/' && history.length > 1) {
      try {
        if (window.next && window.next.router) {
          window.__seerrRestore = navStack.pop() || null; // focus the item we came from
          markNav(); showLoading();
          window.next.router.back();
        } else history.back();
      } catch (e) { try { history.back(); } catch (e2) {} }
      return 'goback';
    }
    focusSidebarFirst();
    return 'sidebar';
  }

  // Focus the currently-highlighted text field. Called by the native side AFTER it has
  // given the WebView view-focus, so the focus actually sticks (a JS focus() before the
  // WebView holds view-focus is silently dropped, leaving the IME with no target).
  window.__seerrFocusInput = function () {
    try {
      if (current && isText(current)) {
        current.focus();
        // Pull the field toward the middle so it stays visible above the keyboard.
        try { current.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e2) {}
        return 'ok';
      }
    } catch (e) {}
    return 'no';
  };

  window.__seerrNav = function (cmd) {
    try {
      if (cmd === 'enter') return activate();
      if (cmd === 'up' || cmd === 'down' || cmd === 'left' || cmd === 'right') { move(cmd); return 'move'; }
      if (cmd === 'pick') { pick(); return 'pick'; }
      if (cmd === 'back') return doBack();
      if (cmd === 'search') return focusSearch();
      if (cmd === 'whereami') return whereami();
      if (cmd === 'focusSidebar') return focusSidebarFirst();
    } catch (e) { return 'err'; }
    return 'noop';
  };

  // Coalesce DOM-change work into one pass per animation frame. Jellyseerr re-renders
  // constantly (the request rows' "x minutes ago" timers tick every second), so doing
  // layout work on every individual mutation made scrolling stutter.
  var moScheduled = false;
  function layoutPass() {
    moScheduled = false;
    // During the render burst right after a route change, do no per-frame work; just
    // re-pick focus once the DOM settles (mutations stop for ~280ms).
    if (navQuietUntil && Date.now() < navQuietUntil) {
      clearTimeout(window.__seerrSettle);
      window.__seerrSettle = setTimeout(function () {
        navQuietUntil = 0;
        hideLoading();
        ensureLayout();
        // After BACK, restore focus to the item we opened (brings its scroll position back
        // too) instead of re-picking and scroll-jumping.
        var r = window.__seerrRestore; window.__seerrRestore = null;
        if (r) { var t = findByUrl(r); if (t) { setFocus(t); return; } }
        pick();
      }, 280);
      return;
    }
    ensureLayout();
    // A modal/menu just opened (e.g. the profile dropdown) -> move focus into it and
    // remember where to return when it closes.
    var ov = visibleOverlay();
    if (ov && (!current || !ov.contains(current))) {
      var items = [].slice.call(ov.querySelectorAll(BROAD)).filter(visible);
      items.sort(function (a, b) { var A = box(a), B = box(b); return (A.t - B.t) || (A.l - B.l); });
      if (items.length) { window.__seerrPreOverlay = current; setFocus(items[0]); return; }
    }
    if (!current || !document.contains(current) || !visible(current)) {
      clearTimeout(window.__seerrNavP);
      window.__seerrNavP = setTimeout(pick, 250);
    }
  }
  function onMutations() {
    if (moScheduled) return;
    moScheduled = true;
    requestAnimationFrame(layoutPass);
  }
  // rAF callbacks are paused while the WebView is backgrounded; if a mutation set
  // moScheduled just before pausing, the rAF never runs and the observer would be dead
  // forever. Reset and re-run when we become visible again.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { moScheduled = false; layoutPass(); }
  });

  try {
    new MutationObserver(onMutations).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  ensureLayout();
  setTimeout(pick, 350);
})();
