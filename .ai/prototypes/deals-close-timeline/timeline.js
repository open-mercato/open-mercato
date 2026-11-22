/* Illustrative drag-to-reschedule and deal drawer for screen 1: cards move between
   week columns of the same lane, shifting the date by whole weeks, and a click or
   Enter opens the deal drawer. Screen 17 renders a static drawer. Nothing is persisted. */
(function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY = 86400000;
  var TODAY = Date.UTC(2026, 9, 26);
  var STAGES = {
    'chart-blue': 'Qualification',
    'chart-cyan': 'Discovery',
    'chart-violet': 'Proposal',
    'chart-amber': 'Negotiation',
    'chart-emerald': 'Commit',
  };
  var CONTACTS = ['Ingrid Malmberg', 'Tobias Renner', 'Aiko Tanabe', 'Lucía Ferreyra', 'Marek Zieliński', 'Noor Haddad', 'Elias Brandt', 'Chiara Bellini'];
  var drag = null;
  var openDrawerState = null;
  var suppressClick = false;
  var flashTimer;

  function inCommentMode() {
    return document.body.classList.contains('proto-comment');
  }

  function parse(value) {
    var parts = value.split('-');
    return Date.UTC(+parts[0], +parts[1] - 1, +parts[2]);
  }

  function iso(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function short(ms) {
    var date = new Date(ms);
    return DOW[date.getUTCDay()] + ', ' + MONTHS[date.getUTCMonth()] + ' ' + date.getUTCDate();
  }

  function long(ms) {
    return short(ms) + ', ' + new Date(ms).getUTCFullYear();
  }

  function setDate(card, ms) {
    card.setAttribute('data-date', iso(ms));
    card.querySelector('.tl-deal-date-text').textContent = short(ms).replace(/^\w+, /, '');
    var overdue = ms < TODAY;
    card.classList.toggle('is-overdue', overdue);
    card.querySelector('.tl-deal-date use').setAttribute('href', overdue ? '#ic-warn' : '#ic-calendar');
    var label = card.getAttribute('aria-label');
    if (label) {
      card.setAttribute('aria-label', label.replace(/, closes .*$/, ', closes ' + long(ms) + (overdue ? ', overdue' : '')));
    }
  }

  function insertSorted(cell, card) {
    var anchor = null;
    Array.prototype.some.call(cell.querySelectorAll(':scope > .tl-deal, :scope > .tl-more'), function (node) {
      if (node === card) return false;
      if (node.classList.contains('tl-more') || node.getAttribute('data-date') > card.getAttribute('data-date')) {
        anchor = node;
        return true;
      }
      return false;
    });
    cell.insertBefore(card, anchor);
  }

  function cellAt(x, y, lane) {
    var hits = document.elementsFromPoint(x, y);
    for (var index = 0; index < hits.length; index += 1) {
      var cell = hits[index].closest && hits[index].closest('.tl-cell');
      if (cell && cell.parentElement === lane) return cell;
    }
    return null;
  }

  function clearTarget() {
    document.querySelectorAll('.tl-live .is-drop-target').forEach(function (cell) { cell.classList.remove('is-drop-target'); });
    var tip = document.querySelector('.tl-live .tl-drag-tip');
    if (tip) tip.remove();
  }

  function showTarget(cell, ms, weeks) {
    clearTarget();
    if (!cell) return;
    cell.classList.add('is-drop-target');
    var tip = document.createElement('div');
    tip.className = 'tl-drag-tip';
    tip.setAttribute('role', 'status');
    var shift = weeks === 0 ? 'No change' : (weeks > 0 ? '+' : '−') + Math.abs(weeks) + (Math.abs(weeks) === 1 ? ' week' : ' weeks');
    tip.innerHTML = '<b>' + long(ms) + '</b><span>' + shift + ' · Esc to cancel</span>';
    cell.appendChild(tip);
  }

  function resetCard(card) {
    card.style.transform = '';
    card.classList.remove('is-dragging', 'is-live-dragging');
  }

  function flash(card, undo) {
    var app = card.closest('.app');
    var existing = app.querySelector('.tl-flash');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'toast tl-flash';
    toast.setAttribute('role', 'status');
    toast.innerHTML = '<svg><use href="#ic-check"/></svg><span><b></b>: close date moved to </span>';
    toast.querySelector('b').textContent = card.querySelector('.tl-deal-company').textContent;
    toast.querySelector('span').appendChild(document.createTextNode(long(parse(card.getAttribute('data-date')))));
    app.appendChild(toast);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      toast.remove();
      card.classList.remove('is-saved');
    }, 6000);

    var main = app.querySelector('main.page');
    var previous = main.querySelector('.tl-op-banner');
    if (previous) previous.remove();
    var banner = document.createElement('div');
    banner.className = 'tl-op-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = '<span><b>Last operation:</b> Update deal</span><button class="btn btn-outline btn-sm" type="button"><svg><use href="#ic-refresh"/></svg> Undo</button>';
    banner.querySelector('button').addEventListener('click', function () {
      undo();
      card.classList.remove('is-saved');
      banner.remove();
      toast.remove();
      card.focus();
    });
    main.insertBefore(banner, main.firstChild);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function dealInfo(card) {
    var stageMatch = (card.getAttribute('style') || '').match(/--(chart-[a-z]+)/);
    var lane = card.closest('.tl-lane');
    var owner = lane ? lane.querySelector('.tl-lane-label .ellipsis') : null;
    var seed = parseInt((card.getAttribute('data-deal') || 'd1').slice(1), 10) || 1;
    var daysInStage = 4 + (seed * 11) % 45;
    var dateMs = parse(card.getAttribute('data-date'));
    return {
      id: card.getAttribute('data-deal'),
      title: card.querySelector('.tl-deal-title').textContent,
      probability: card.querySelector('.tl-deal-prob').textContent,
      value: card.querySelector('b.num').textContent,
      company: card.querySelector('.tl-deal-company').textContent,
      owner: owner ? owner.textContent : 'Unassigned',
      person: CONTACTS[seed % CONTACTS.length],
      stage: stageMatch ? STAGES[stageMatch[1]] || 'Stage' : 'Stage',
      stageVar: stageMatch ? stageMatch[1] : 'chart-blue',
      date: long(dateMs),
      overdue: dateMs < TODAY,
      openActivities: seed % 3,
      daysInStage: daysInStage,
      stalled: daysInStage > 30,
      readOnly: card.classList.contains('is-readonly'),
    };
  }

  function drawerHtml(info) {
    var manage = !info.readOnly;
    var activities = info.openActivities === 0
      ? '<span class="tl-drawer-warn"><svg><use href="#ic-warn"/></svg>No open activities</span>'
      : info.openActivities + (info.openActivities === 1 ? ' open activity' : ' open activities');
    var action = function (name, icon, label) {
      return manage
        ? '<button class="btn btn-outline btn-sm" type="button" data-tl-drawer-action="' + name + '"><svg><use href="#' + icon + '"/></svg> ' + label + '</button>'
        : '';
    };
    var title = manage
      ? '<a class="tl-drawer-link" href="#s15" data-goto="s15" title="Open the existing deal page">' + escapeHtml(info.title) + '</a>'
      : escapeHtml(info.title);
    return '<aside class="drawer tl-drawer" role="dialog" aria-modal="true" aria-labelledby="tl-drawer-title-' + escapeHtml(info.id) + '">'
      + '<div class="drawer-head">'
      + '<div class="grow"><h3 class="t-section" id="tl-drawer-title-' + escapeHtml(info.id) + '">' + title + '</h3>'
      + '<p class="t-hint tl-drawer-sub">'
      + '<a class="tl-drawer-link" href="#s15" data-goto="s15" title="Open the existing company page"><svg><use href="#ic-building"/></svg>' + escapeHtml(info.company) + '</a>'
      + '<a class="tl-drawer-link" href="#s15" data-goto="s15" title="Open the existing person page"><svg><use href="#ic-user"/></svg>' + escapeHtml(info.person) + '</a>'
      + '</p></div>'
      + '<button class="icon-btn" type="button" aria-label="Close" data-tl-drawer-close><svg><use href="#ic-x"/></svg></button>'
      + '</div>'
      + '<div class="drawer-body">'
      + '<section class="tl-drawer-hero">'
      + '<div><div class="t-label">Expected close</div>'
      + '<div class="tl-drawer-date tl-drawer-date-lg' + (info.overdue ? ' is-overdue' : '') + '">'
      + '<svg><use href="' + (info.overdue ? '#ic-warn' : '#ic-calendar') + '"/></svg>' + escapeHtml(info.date) + (info.overdue ? ' · overdue' : '') + '</div></div>'
      + action('date', 'ic-calendar', 'Change close date')
      + '</section>'
      + '<dl class="tl-drawer-fields">'
      + '<div><dt>Value</dt><dd class="num strong">' + escapeHtml(info.value) + '</dd></div>'
      + '<div><dt>Probability</dt><dd class="num">' + escapeHtml(info.probability) + '</dd></div>'
      + '<div class="tl-drawer-wide"><dt>Stage</dt><dd class="tl-drawer-line"><span class="row"><i class="tl-stage-dot" style="--stage:var(--' + escapeHtml(info.stageVar) + ')"></i>' + escapeHtml(info.stage)
      + '<span class="badge badge-info"><span class="dot"></span>Open</span></span>' + action('stage', 'ic-arrow-right', 'Change stage') + '</dd></div>'
      + '<div class="tl-drawer-wide"><dt>Owner</dt><dd>' + escapeHtml(info.owner) + '</dd></div>'
      + '</dl>'
      + '<section class="tl-drawer-section"><div class="tl-drawer-line"><div class="t-label">Activity</div>' + action('follow-up', 'ic-plus', 'Schedule follow-up') + '</div>'
      + '<ul class="tl-drawer-signals">'
      + '<li>' + activities + '</li>'
      + '<li>In ' + escapeHtml(info.stage) + ' for ' + info.daysInStage + ' days</li>'
      + (info.stalled ? '<li><span class="badge badge-warning"><span class="dot"></span>Stalled</span></li>' : '')
      + '</ul></section>'
      + (manage
        ? '<section class="tl-drawer-section tl-drawer-closing"><div class="t-label">Close deal</div><div class="tl-drawer-actions">'
          + action('won', 'ic-check', 'Mark won') + action('lost', 'ic-x', 'Mark lost') + '</div></section>'
        : '<p class="t-hint tl-drawer-note"><svg><use href="#ic-lock"/></svg>You can view this deal. Changing it or opening the deal page needs the manage-deals permission.</p>')
      + '<p class="t-hint">Field edits happen on the existing deal page. For a won or lost deal the drawer keeps only Schedule follow-up, so a closed result never moves between reporting periods.</p>'
      + '</div>'
      + '</aside>';
  }

  function setFrameUrl(app, dealId) {
    var url = app.closest('.frame').querySelector('.frame-url');
    if (!url) return;
    if (!url.hasAttribute('data-base')) url.setAttribute('data-base', url.textContent);
    url.textContent = url.getAttribute('data-base') + (dealId ? '?deal=' + dealId : '');
  }

  function drawerNotice(app, text) {
    var existing = app.querySelector('.tl-flash');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'toast tl-flash';
    toast.setAttribute('role', 'status');
    toast.innerHTML = '<svg><use href="#ic-info"/></svg><span></span>';
    toast.querySelector('span').textContent = text;
    app.appendChild(toast);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { toast.remove(); }, 4000);
  }

  function closeDrawer(restoreFocus) {
    if (!openDrawerState) return;
    var state = openDrawerState;
    openDrawerState = null;
    state.drawer.remove();
    state.app.classList.remove('drawer-scrim');
    setFrameUrl(state.app, null);
    if (restoreFocus !== false && state.card.isConnected) state.card.focus();
  }

  function openDrawer(card) {
    closeDrawer();
    var app = card.closest('.app');
    var holder = document.createElement('div');
    holder.innerHTML = drawerHtml(dealInfo(card));
    var drawer = holder.firstChild;
    app.classList.add('drawer-scrim');
    app.appendChild(drawer);
    setFrameUrl(app, card.getAttribute('data-deal'));
    openDrawerState = { app: app, card: card, drawer: drawer };
    drawer.querySelector('[data-tl-drawer-close]').focus();
  }

  var ACTION_NOTICES = {
    'follow-up': 'Opens the existing scheduling dialog (ScheduleActivityDialog) with a date, linked to this deal.',
    stage: 'Opens the existing Change stage dialog from the Kanban.',
    won: 'Runs the existing closure flow from the deal page.',
    lost: 'Opens the existing lost-reason dialog (ConfirmDealLostDialog).',
  };

  document.addEventListener('click', function (event) {
    if (!openDrawerState) return;
    var state = openDrawerState;
    if (event.target === state.app) {
      closeDrawer();
      return;
    }
    if (event.target.closest('[data-tl-drawer-close]')) {
      closeDrawer();
      return;
    }
    var action = event.target.closest('[data-tl-drawer-action]');
    if (!action) {
      if (event.target.closest('[data-goto]') && state.drawer.contains(event.target)) closeDrawer(false);
      return;
    }
    var kind = action.getAttribute('data-tl-drawer-action');
    if (kind === 'date') {
      closeDrawer(false);
      var opener = document.getElementById('tl-open-dialog');
      if (opener) opener.click();
      return;
    }
    drawerNotice(state.app, ACTION_NOTICES[kind]);
  });

  document.querySelectorAll('[data-tl-drawer-static]').forEach(function (placeholder) {
    var app = placeholder.closest('.app');
    var card = app.querySelector('.tl-deal[data-deal="' + placeholder.getAttribute('data-tl-drawer-static') + '"]');
    if (!card) return;
    var holder = document.createElement('div');
    holder.innerHTML = drawerHtml(dealInfo(card));
    placeholder.replaceWith(holder.firstChild);
  });

  function cancel() {
    if (!drag) return;
    resetCard(drag.card);
    clearTarget();
    suppressClick = drag.moved;
    drag = null;
  }

  document.addEventListener('pointerdown', function (event) {
    if (inCommentMode() || event.button !== 0) return;
    var card = event.target.closest('.tl-live .tl-deal');
    if (!card) return;
    var cell = card.parentElement;
    drag = {
      card: card,
      lane: cell.parentElement,
      origin: cell,
      originCol: +cell.getAttribute('data-col'),
      originDate: parse(card.getAttribute('data-date')),
      startX: event.clientX,
      startY: event.clientY,
      target: null,
      moved: false,
    };
    card.setPointerCapture(event.pointerId);
  });

  document.addEventListener('pointermove', function (event) {
    if (!drag) return;
    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    drag.moved = true;
    drag.card.classList.add('is-dragging', 'is-live-dragging');
    drag.card.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) rotate(1deg)';
    var cell = cellAt(event.clientX, event.clientY, drag.lane);
    drag.target = cell;
    if (!cell) { clearTarget(); return; }
    var weeks = +cell.getAttribute('data-col') - drag.originCol;
    showTarget(cell, drag.originDate + weeks * 7 * DAY, weeks);
  });

  document.addEventListener('pointerup', function () {
    if (!drag) return;
    var finished = drag;
    drag = null;
    resetCard(finished.card);
    clearTarget();
    if (!finished.moved) return;
    suppressClick = true;
    var target = finished.target;
    if (!target || target === finished.origin) return;
    var weeks = +target.getAttribute('data-col') - finished.originCol;
    var originNext = finished.card.nextSibling;
    setDate(finished.card, finished.originDate + weeks * 7 * DAY);
    insertSorted(target, finished.card);
    finished.card.classList.add('is-saved');
    flash(finished.card, function () {
      setDate(finished.card, finished.originDate);
      finished.origin.insertBefore(finished.card, originNext && originNext.parentElement === finished.origin ? originNext : null);
    });
  });

  document.addEventListener('click', function (event) {
    if (!suppressClick) return;
    if (event.target.closest('.tl-live .tl-deal')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    suppressClick = false;
  }, true);

  document.addEventListener('click', function (event) {
    var card = event.target.closest('.tl-live .tl-deal');
    if (!card || inCommentMode()) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openDrawer(card);
  }, true);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      cancel();
      return;
    }
    if (openDrawerState && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDrawer();
      return;
    }
    if (openDrawerState && event.key === 'Tab') {
      var focusable = openDrawerState.drawer.querySelectorAll('button, a[href]');
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    var card = event.target.closest && event.target.closest('.tl-live .tl-deal');
    if (!card || inCommentMode()) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      openDrawer(card);
      return;
    }
    var next = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      var siblings = Array.prototype.slice.call(card.parentElement.querySelectorAll(':scope > .tl-deal'));
      next = siblings[siblings.indexOf(card) + (event.key === 'ArrowDown' ? 1 : -1)];
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      var cell = card.parentElement;
      while (!next) {
        cell = event.key === 'ArrowRight' ? cell.nextElementSibling : cell.previousElementSibling;
        if (!cell || !cell.classList.contains('tl-cell')) break;
        next = cell.querySelector(':scope > .tl-deal');
      }
    }
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }, true);
})();
