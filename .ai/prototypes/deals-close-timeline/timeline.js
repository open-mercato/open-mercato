/* Illustrative drag-to-reschedule for screen 1: cards move between week
   columns of the same lane, shifting the date by whole weeks. Nothing is persisted. */
(function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY = 86400000;
  var TODAY = Date.UTC(2026, 9, 26);
  var drag = null;
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
    toast.innerHTML = '<svg><use href="#ic-check"/></svg><span><b></b>: close date moved to </span><button class="btn btn-outline btn-xs" type="button">Undo</button>';
    toast.querySelector('b').textContent = card.querySelector('.tl-deal-company').textContent;
    toast.querySelector('span').appendChild(document.createTextNode(long(parse(card.getAttribute('data-date')))));
    toast.querySelector('button').addEventListener('click', function () {
      undo();
      card.classList.remove('is-saved');
      toast.remove();
      card.focus();
    });
    app.appendChild(toast);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      toast.remove();
      card.classList.remove('is-saved');
    }, 6000);
  }

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

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      cancel();
      return;
    }
    var card = event.target.closest && event.target.closest('.tl-live .tl-deal');
    if (!card || inCommentMode()) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      var opener = document.getElementById('tl-open-dialog');
      if (opener) opener.click();
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
