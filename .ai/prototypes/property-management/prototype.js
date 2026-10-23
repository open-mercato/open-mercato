/* Interactive prototype engine: click-through, presentation, and review comments. */
(function () {
  'use strict';

  var prototypeId = document.documentElement.getAttribute('data-prototype-id') || 'prototype';
  var threadsStorageKey = 'om-prototype-comments:v2:' + prototypeId;
  var authorStorageKey = 'om-prototype-author';
  var committedDocument = normalizeDocument(window.__OM_PROTOTYPE_COMMENTS__);
  var committedOperations = clone(committedDocument.operations);
  deepFreeze(committedOperations);
  var committedOperationIds = new Set(committedOperations.map(function (operation) { return operation.id; }));
  var localOperations = normalizeOperations(load(threadsStorageKey, { version: 2, operations: [] }).operations)
    .filter(function (operation) { return !committedOperationIds.has(operation.id); });
  var author = load(authorStorageKey, '');
  var threads = [];
  var mode = 'click';
  var focusMode = false;
  var hints = false;
  var pinsVisible = true;
  var activeId = null;
  var pending = null;
  var reanchorThreadId = null;
  var history = [];
  var panel;
  var panelBody;
  var authorInput;
  var clickModeButton;
  var commentModeButton;
  var toastTimer;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return value;
  }

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function save() {
    try {
      localStorage.setItem(threadsStorageKey, JSON.stringify({ version: 2, operations: localOperations }));
      localStorage.setItem(authorStorageKey, JSON.stringify(author));
    } catch (error) {
      return;
    }
  }

  function normalizeDocument(value) {
    if (!value || value.version !== 2 || !Array.isArray(value.operations)) {
      return { version: 2, prototypeId: prototypeId, operations: [] };
    }
    if (value.prototypeId && value.prototypeId !== prototypeId) {
      return { version: 2, prototypeId: prototypeId, operations: [] };
    }
    return { version: 2, prototypeId: prototypeId, operations: normalizeOperations(value.operations) };
  }

  function normalizeOperations(operations) {
    var seen = new Set();
    return (Array.isArray(operations) ? operations : []).filter(function (operation) {
      if (!operation || typeof operation.id !== 'string' || seen.has(operation.id)) return false;
      if (!operation.threadId || !operation.type || !operation.at) return false;
      seen.add(operation.id);
      return true;
    });
  }

  function allOperations() {
    return normalizeOperations(committedOperations.concat(localOperations)).sort(function (left, right) {
      return left.at.localeCompare(right.at) || left.id.localeCompare(right.id);
    });
  }

  function applyOperations() {
    var byId = new Map();
    var order = [];
    allOperations().forEach(function (operation) {
      var thread = byId.get(operation.threadId);
      if (operation.type === 'create') {
        if (thread || !operation.payload || !operation.payload.message) return;
        thread = {
          id: operation.threadId,
          screen: operation.payload.screen,
          anchor: operation.payload.anchor,
          label: operation.payload.label,
          resolved: false,
          messages: [operation.payload.message],
          deletedAt: null
        };
        byId.set(thread.id, thread);
        order.push(thread.id);
        return;
      }
      if (!thread) return;
      if (operation.type === 'delete') {
        thread.deletedAt = operation.at;
        return;
      }
      if (thread.deletedAt) return;
      if (operation.type === 'reply' && operation.payload && operation.payload.message) {
        var messageExists = thread.messages.some(function (message) {
          return message.id === operation.payload.message.id;
        });
        if (!messageExists) thread.messages.push(operation.payload.message);
      }
      if (operation.type === 'set-resolved' && operation.payload) {
        thread.resolved = !!operation.payload.resolved;
      }
      if (operation.type === 'reanchor' && operation.payload) {
        thread.screen = operation.payload.screen;
        thread.anchor = operation.payload.anchor;
        thread.label = operation.payload.label;
      }
    });
    threads = order.map(function (threadId) { return byId.get(threadId); })
      .filter(function (thread) { return thread && !thread.deletedAt; });
  }

  function addOperation(type, threadId, payload) {
    localOperations.push({
      id: newId('op'),
      type: type,
      threadId: threadId,
      at: new Date().toISOString(),
      payload: payload || {}
    });
    save();
    applyOperations();
  }

  function hasLocalChanges(threadId) {
    return localOperations.some(function (operation) { return operation.threadId === threadId; });
  }

  function element(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (key === 'class') node.className = props[key];
      else if (key === 'text') node.textContent = props[key];
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), props[key]);
      else node.setAttribute(key, props[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function nowStamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }

  function newId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + '-' + window.crypto.randomUUID();
    }
    return prefix + '-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function screens() {
    return Array.prototype.slice.call(document.querySelectorAll('.screen'));
  }

  function goTo(screenId, record) {
    var target = document.getElementById(screenId);
    if (!target) {
      flashToast('This screen does not exist in the prototype: ' + screenId);
      return;
    }
    if (record !== false) {
      var current = document.querySelector('.screen.is-current');
      if (current && current.id !== screenId) history.push(current.id);
    }
    if (focusMode) {
      screens().forEach(function (screen) { screen.classList.remove('is-current'); });
      target.classList.add('is-current');
      window.scrollTo(0, 0);
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    target.classList.remove('proto-arrived');
    void target.offsetWidth;
    target.classList.add('proto-arrived');
    updateBackButton();
  }

  function goBack() {
    var previous = history.pop();
    if (previous) goTo(previous, false);
    updateBackButton();
  }

  function updateBackButton() {
    var button = document.querySelector('.proto-back');
    if (button) button.disabled = history.length === 0;
  }

  function flashToast(text) {
    var existing = document.querySelector('.proto-toast');
    if (existing) existing.remove();
    var toast = element('div', { class: 'toast proto-toast', text: text });
    document.body.appendChild(toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.remove(); }, 2600);
  }

  function anchorFor(node, screenElement) {
    var parts = [];
    while (node && node !== screenElement) {
      var parent = node.parentElement;
      if (!parent) return null;
      var tag = node.tagName.toLowerCase();
      var sameTag = Array.prototype.filter.call(parent.children, function (child) {
        return child.tagName === node.tagName;
      });
      parts.unshift(sameTag.length > 1 ? tag + ':' + (sameTag.indexOf(node) + 1) : tag);
      node = parent;
    }
    return parts.join('>');
  }

  function resolveAnchor(screenElement, path) {
    if (!path) return null;
    var node = screenElement;
    var parts = path.split('>');
    for (var partIndex = 0; partIndex < parts.length; partIndex += 1) {
      var bits = parts[partIndex].split(':');
      var tag = bits[0];
      var index = bits[1] ? parseInt(bits[1], 10) : 1;
      var matches = Array.prototype.filter.call(node.children, function (child) {
        return child.tagName.toLowerCase() === tag;
      });
      node = matches[index - 1];
      if (!node) return null;
    }
    return node;
  }

  function labelFor(node) {
    var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return '<' + node.tagName.toLowerCase() + '>';
    return text.length > 60 ? text.slice(0, 60) + '…' : text;
  }

  function clearPins() {
    document.querySelectorAll('.anno-pin-layer').forEach(function (layer) { layer.remove(); });
    document.querySelectorAll('.anno-target-active').forEach(function (node) {
      node.classList.remove('anno-target-active');
    });
  }

  function pinLayerFor(frame) {
    var layer = element('div', { class: 'anno-pin-layer', 'aria-hidden': 'false' });
    frame.appendChild(layer);
    return layer;
  }

  function renderPins() {
    clearPins();
    var orphans = [];
    var counters = {};
    var layers = new Map();

    threads.forEach(function (thread) {
      var screenElement = document.getElementById(thread.screen);
      if (!screenElement) {
        thread._orphan = true;
        orphans.push(thread);
        return;
      }
      counters[thread.screen] = (counters[thread.screen] || 0) + 1;
      thread._num = counters[thread.screen];
      if (!thread.anchor) {
        thread._orphan = false;
        return;
      }

      var target = resolveAnchor(screenElement, thread.anchor);
      var frame = target && target.closest('.frame');
      if (!target || !frame) {
        thread._orphan = true;
        orphans.push(thread);
        return;
      }
      thread._orphan = false;
      var layer = layers.get(frame);
      if (!layer) {
        layer = pinLayerFor(frame);
        layers.set(frame, layer);
      }
      var targetRect = target.getBoundingClientRect();
      var frameRect = frame.getBoundingClientRect();
      var classes = ['anno-pin'];
      if (thread.resolved) classes.push('resolved');
      else if (hasLocalChanges(thread.id)) classes.push('unsaved');
      var pin = element('button', {
        class: classes.join(' '),
        type: 'button',
        title: (thread.messages[0] || {}).text || '',
        'aria-label': 'Comment ' + thread._num,
        text: String(thread._num),
        onclick: function (event) {
          event.preventDefault();
          event.stopPropagation();
          activeId = thread.id;
          openPanel();
        }
      });
      pin.style.left = Math.max(0, targetRect.right - frameRect.left - 10) + 'px';
      pin.style.top = Math.max(0, targetRect.top - frameRect.top - 10) + 'px';
      layer.appendChild(pin);
      if (thread.id === activeId) target.classList.add('anno-target-active');
    });
    window.__prototypeOrphans = orphans;
    renderNavigationCounts();
  }

  function renderNavigationCounts() {
    document.querySelectorAll('.screen-nav a[href^="#"]').forEach(function (link) {
      var oldCount = link.querySelector('.anno-count');
      if (oldCount) oldCount.remove();
      var screenId = link.getAttribute('href').slice(1);
      var openCount = threads.filter(function (thread) {
        return thread.screen === screenId && !thread.resolved;
      }).length;
      if (openCount) link.appendChild(element('span', { class: 'anno-count', text: String(openCount) }));
    });
  }

  function buildPanel() {
    panelBody = element('div', { class: 'anno-panel-body' });
    authorInput = element('input', {
      class: 'input',
      placeholder: 'Your name for review comments',
      value: author || '',
      oninput: function (event) { author = event.target.value; save(); }
    });
    panel = element('aside', { class: 'anno-panel', 'aria-label': 'Prototype comments' }, [
      element('div', { class: 'anno-panel-head' }, [
        element('strong', { class: 't-card-title', text: 'Comments' }),
        element('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Close', onclick: closePanel })
      ]),
      panelBody,
      element('div', { class: 'anno-panel-foot' }, [
        authorInput,
        element('div', { class: 'row' }, [
          element('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Export for repository', onclick: exportRepository }),
          element('button', { class: 'btn btn-outline btn-sm', type: 'button', text: 'Export Markdown', onclick: exportMarkdown })
        ])
      ])
    ]);
    document.body.appendChild(panel);
  }

  function openPanel() {
    panel.classList.add('open');
    document.body.classList.add('anno-open');
    renderPins();
    renderPanel();
  }

  function closePanel() {
    panel.classList.remove('open');
    document.body.classList.remove('anno-open');
    pending = null;
    activeId = null;
    renderPins();
  }

  function renderPanel() {
    panelBody.textContent = '';
    if (pending) panelBody.appendChild(composerCard());
    if (localOperations.length) {
      panelBody.appendChild(element('div', {
        class: 'anno-dirty-note',
        text: localOperations.length + ' local review operation' + (localOperations.length === 1 ? '' : 's') +
          ' must be exported and committed before the team can see them.'
      }));
    }

    var visibleThreads = threads.filter(function (thread) { return !thread._orphan; });
    if (!visibleThreads.length && !pending) {
      panelBody.appendChild(element('div', {
        class: 'anno-empty',
        text: 'No comments yet. Switch to Comment mode and select an element.'
      }));
    }

    var byScreen = {};
    visibleThreads.forEach(function (thread) {
      (byScreen[thread.screen] = byScreen[thread.screen] || []).push(thread);
    });
    Object.keys(byScreen).forEach(function (screenId) {
      var heading = document.querySelector('#' + screenId + ' .screen-meta h2');
      panelBody.appendChild(element('div', { class: 't-overline', text: heading ? heading.textContent : screenId }));
      byScreen[screenId].forEach(function (thread) { panelBody.appendChild(threadCard(thread)); });
    });

    var orphans = window.__prototypeOrphans || [];
    if (orphans.length) {
      var orphanBox = element('div', { class: 'anno-orphans' }, [
        element('strong', { class: 't-card-title', text: 'Orphaned threads (' + orphans.length + ')' }),
        element('div', {
          class: 't-hint',
          text: 'The original target no longer exists. Re-anchor the thread or resolve it; its content is preserved.'
        })
      ]);
      orphans.forEach(function (thread) { orphanBox.appendChild(threadCard(thread)); });
      panelBody.appendChild(orphanBox);
    }

    var activeCard = panelBody.querySelector('.anno-thread.active');
    if (activeCard) activeCard.scrollIntoView({ block: 'nearest' });
  }

  function composerCard() {
    var input = element('textarea', { placeholder: 'What should change?' });
    var card = element('div', { class: 'anno-thread active' }, [
      element('div', { class: 'anno-thread-head' }, [
        element('span', { class: 'anno-num', text: '+' }),
        element('span', { class: 'anno-anchor', text: pending.label })
      ]),
      element('div', { class: 'anno-composer' }, [
        input,
        element('div', { class: 'anno-composer-actions' }, [
          element('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Add comment', onclick: function () { commitNew(input.value); } }),
          element('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Cancel', onclick: cancelComposer })
        ])
      ])
    ]);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commitNew(input.value);
      if (event.key === 'Escape') cancelComposer();
    });
    setTimeout(function () { input.focus(); }, 0);
    return card;
  }

  function cancelComposer() {
    pending = null;
    renderPanel();
    renderPins();
  }

  function commitNew(text) {
    if (!text.trim()) return;
    var threadId = newId('thread');
    addOperation('create', threadId, {
      screen: pending.screen,
      anchor: pending.anchor,
      label: pending.label,
      message: { id: newId('message'), author: author || 'Anonymous', text: text.trim(), at: nowStamp() }
    });
    pending = null;
    activeId = threadId;
    renderPins();
    renderPanel();
  }

  function threadCard(thread) {
    var classes = ['anno-thread'];
    if (thread.id === activeId) classes.push('active');
    if (thread.resolved) classes.push('resolved');
    var card = element('div', {
      class: classes.join(' '),
      onclick: function (event) {
        if (event.target.closest('textarea, input, button, a, select, label')) return;
        activeId = thread.id;
        renderPins();
        renderPanel();
        if (focusMode) goTo(thread.screen);
        else {
          var screenElement = document.getElementById(thread.screen);
          if (screenElement) screenElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }, [
      element('div', { class: 'anno-thread-head' }, [
        element('span', { class: 'anno-num', text: String(thread._num || '?') }),
        element('span', { class: 'anno-anchor', title: thread.label, text: thread.label }),
        hasLocalChanges(thread.id) ? element('span', { class: 'badge badge-warning', text: 'local' }) : null
      ])
    ]);

    thread.messages.forEach(function (message) {
      card.appendChild(element('div', { class: 'anno-msg' }, [
        element('div', { class: 'anno-msg-meta' }, [
          element('span', { class: 'who', text: message.author }),
          element('span', { text: message.at })
        ]),
        element('div', { class: 'anno-msg-text', text: message.text })
      ]));
    });

    if (thread.id === activeId) {
      var reply = element('textarea', { placeholder: 'Reply…' });
      reply.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) addReply(thread, reply.value);
      });
      card.appendChild(element('div', { class: 'anno-composer' }, [
        reply,
        element('div', { class: 'anno-composer-actions' }, [
          element('button', { class: 'btn btn-outline btn-sm', type: 'button', text: 'Reply', onclick: function (event) {
            event.stopPropagation();
            addReply(thread, reply.value);
          } }),
          element('button', { class: 'btn btn-outline btn-sm', type: 'button', text: 'Re-anchor', onclick: function (event) {
            event.stopPropagation();
            beginReanchor(thread);
          } }),
          element('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: thread.resolved ? 'Reopen' : 'Resolve', onclick: function (event) {
            event.stopPropagation();
            addOperation('set-resolved', thread.id, { resolved: !thread.resolved });
            renderPins();
            renderPanel();
          } }),
          element('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Delete', onclick: function (event) {
            event.stopPropagation();
            if (!confirm('Delete this thread? The exported tombstone prevents accidental resurrection.')) return;
            addOperation('delete', thread.id, {});
            activeId = null;
            renderPins();
            renderPanel();
          } })
        ])
      ]));
      setTimeout(function () { reply.focus(); }, 0);
    }
    return card;
  }

  function addReply(thread, text) {
    if (!text.trim()) return;
    addOperation('reply', thread.id, {
      message: { id: newId('message'), author: author || 'Anonymous', text: text.trim(), at: nowStamp() }
    });
    renderPins();
    renderPanel();
  }

  function beginReanchor(thread) {
    reanchorThreadId = thread.id;
    setMode('comment');
    closePanel();
    flashToast('Select the new element for this thread. Press Escape to cancel.');
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = element('a', { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportRepository() {
    var exported = { version: 2, prototypeId: prototypeId, operations: allOperations() };
    var header = [
      '/* Committed prototype review operations.',
      ' * Generated by "Export for repository". Replace this file and commit it.',
      ' * Operations are append-only; delete operations are durable tombstones.',
      ' */',
      'window.__OM_PROTOTYPE_COMMENTS__ = '
    ].join('\n');
    download('comments.js', header + JSON.stringify(exported, null, 2) + ';\n', 'text/javascript');
  }

  function exportMarkdown() {
    var title = (document.querySelector('.doc-head h1') || {}).textContent || 'Prototype';
    var lines = ['# Prototype feedback — ' + title, ''];
    var byScreen = {};
    threads.forEach(function (thread) {
      (byScreen[thread.screen] = byScreen[thread.screen] || []).push(thread);
    });
    Object.keys(byScreen).forEach(function (screenId) {
      var heading = document.querySelector('#' + screenId + ' .screen-meta h2');
      lines.push('## ' + (heading ? heading.textContent : screenId), '');
      byScreen[screenId].forEach(function (thread) {
        lines.push('- **' + (thread.label || 'screen') + '**' + (thread.resolved ? ' _(resolved)_' : ''));
        thread.messages.forEach(function (message) {
          lines.push('  - ' + message.author + ' (' + message.at + '): ' + message.text.replace(/\n/g, ' '));
        });
        lines.push('');
      });
    });
    download('prototype-feedback.md', lines.join('\n'), 'text/markdown');
  }

  function setMode(nextMode) {
    mode = nextMode;
    document.body.classList.toggle('proto-comment', mode === 'comment');
    document.body.classList.toggle('proto-click', mode === 'click');
    if (clickModeButton) clickModeButton.setAttribute('aria-selected', String(mode === 'click'));
    if (commentModeButton) commentModeButton.setAttribute('aria-selected', String(mode === 'comment'));
    if (mode === 'comment' && panel && !reanchorThreadId) openPanel();
  }

  function onDocumentClick(event) {
    if (event.target.closest('.anno-panel') || event.target.closest('.doc-toolbar')) return;
    if (event.target.closest('.anno-pin')) return;
    var frame = event.target.closest('.frame');
    if (!frame) return;

    if (mode === 'comment') {
      event.preventDefault();
      event.stopPropagation();
      var target = event.target;
      while (target && (target.tagName === 'use' || String(target.tagName).toLowerCase() === 'svg')) {
        target = target.parentElement;
      }
      if (!target || target.classList.contains('anno-pin-layer')) return;
      var screenElement = target.closest('.screen');
      if (!screenElement) return;
      var anchor = { screen: screenElement.id, anchor: anchorFor(target, screenElement), label: labelFor(target) };
      if (reanchorThreadId) {
        var threadId = reanchorThreadId;
        reanchorThreadId = null;
        addOperation('reanchor', threadId, anchor);
        activeId = threadId;
        openPanel();
        flashToast('Thread re-anchored.');
        return;
      }
      pending = anchor;
      activeId = null;
      openPanel();
      return;
    }

    if (event.target.closest('[data-availability-toggle]')) return;
    var hotspot = event.target.closest('[data-goto]');
    if (hotspot) {
      event.preventDefault();
      goTo(hotspot.getAttribute('data-goto'));
    }
  }

  function prepareHotspots() {
    document.querySelectorAll('[data-goto]').forEach(function (hotspot) {
      var tag = hotspot.tagName.toLowerCase();
      var nativeInteractive = tag === 'a' || tag === 'button';
      if (!nativeInteractive) {
        hotspot.setAttribute('role', 'button');
        hotspot.setAttribute('tabindex', '0');
        hotspot.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          goTo(hotspot.getAttribute('data-goto'));
        });
      }
    });
  }

  function closeLocationSwitchers() {
    document.querySelectorAll('.floorplan-switch-menu, .location-switch-menu').forEach(function (menu) { menu.hidden = true; });
    document.querySelectorAll('.floorplan-switch[aria-expanded="true"], .location-switch[aria-expanded="true"]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  function prepareLocationSwitchers() {
    document.querySelectorAll('.floorplan-switch-wrap, .location-switch-wrap').forEach(function (wrap) {
      var btn = wrap.querySelector('.floorplan-switch, .location-switch');
      var menu = wrap.querySelector('.floorplan-switch-menu, .location-switch-menu');
      if (!btn || !menu) return;
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var willOpen = menu.hidden;
        closeLocationSwitchers();
        if (willOpen) {
          menu.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
        }
      });
      menu.querySelectorAll('.menu-item:not(.is-current)').forEach(function (item) {
        item.addEventListener('click', function (event) {
          event.stopPropagation();
          flashToast('Switching locations is illustrative — only Harbor Point is modeled in this prototype.');
          closeLocationSwitchers();
        });
      });
    });
    document.addEventListener('click', closeLocationSwitchers);
  }

  function prepareViewSwitches() {
    document.querySelectorAll('.view-switch[role="tablist"]').forEach(function (switcher) {
      var scope = switcher.closest('.page') || switcher.parentElement;
      switcher.querySelectorAll('button[data-view]').forEach(function (tab) {
        tab.addEventListener('click', function () {
          switcher.querySelectorAll('button[data-view]').forEach(function (other) {
            other.setAttribute('aria-selected', other === tab ? 'true' : 'false');
          });
          var view = tab.getAttribute('data-view');
          scope.querySelectorAll('[data-view-panel]').forEach(function (panel) {
            panel.hidden = panel.getAttribute('data-view-panel') !== view;
          });
        });
      });
    });
  }

  function svgIcon(id) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function preparePagination() {
    document.querySelectorAll('[data-paginate]').forEach(function (container) {
      var size = parseInt(container.getAttribute('data-paginate'), 10) || 10;
      var noun = container.getAttribute('data-paginate-label') || 'rows';
      var rows = Array.prototype.slice.call(container.querySelectorAll('tbody > tr'));
      var foot = container.querySelector('.dt-foot');
      var pager = foot && foot.querySelector('.pager');
      var status = foot && foot.querySelector('[data-page-status]');
      if (!pager || !rows.length) return;

      var pages = Math.max(1, Math.ceil(rows.length / size));
      var current = 1;
      var numbers = [];

      function render() {
        rows.forEach(function (row, index) {
          row.hidden = Math.floor(index / size) + 1 !== current;
        });
        var first = (current - 1) * size + 1;
        var last = Math.min(current * size, rows.length);
        if (status) status.textContent = 'Showing ' + first + '\u2013' + last + ' of ' + rows.length + ' ' + noun;
        numbers.forEach(function (button, index) {
          if (index + 1 === current) button.setAttribute('aria-current', 'page');
          else button.removeAttribute('aria-current');
        });
        previous.disabled = current === 1;
        next.disabled = current === pages;
      }

      function goToPage(page) {
        current = Math.min(pages, Math.max(1, page));
        render();
      }

      var previous = element('button', {
        type: 'button', class: 'nav', 'aria-label': 'Previous page',
        onclick: function () { goToPage(current - 1); }
      }, [svgIcon('ic-chevron-left')]);
      var next = element('button', {
        type: 'button', class: 'nav', 'aria-label': 'Next page',
        onclick: function () { goToPage(current + 1); }
      }, [svgIcon('ic-chevron-right')]);

      pager.textContent = '';
      pager.appendChild(element('li', {}, [previous]));
      for (var page = 1; page <= pages; page += 1) {
        var button = element('button', { type: 'button', text: String(page) });
        (function (target) {
          button.addEventListener('click', function () { goToPage(target); });
        })(page);
        numbers.push(button);
        pager.appendChild(element('li', {}, [button]));
      }
      pager.appendChild(element('li', {}, [next]));
      render();
    });
  }

  function closePortalNotifications() {
    document.querySelectorAll('.notif-panel').forEach(function (panel) { panel.hidden = true; });
    document.querySelectorAll('.portal-bell[aria-expanded="true"]').forEach(function (bell) {
      bell.setAttribute('aria-expanded', 'false');
    });
  }

  function preparePortalNotifications() {
    var populated = document.getElementById('tpl-portal-notifications');
    if (!populated) return;
    document.querySelectorAll('.portal-bell-wrap').forEach(function (wrap) {
      var variant = wrap.getAttribute('data-notifications');
      var source = variant ? document.getElementById('tpl-portal-notifications-' + variant) : populated;
      if (!source) source = populated;
      if (!source) return;
      var panel = source.content.firstElementChild.cloneNode(true);
      var bell = wrap.querySelector('.portal-bell');
      if (!bell) return;
      wrap.appendChild(panel);

      var unread = panel.querySelectorAll('.notif-item.is-unread').length;
      if (unread) bell.appendChild(element('span', { class: 'notif-dot', text: String(unread) }));

      var startOpen = wrap.hasAttribute('data-notifications-open');
      panel.hidden = !startOpen;
      bell.setAttribute('aria-expanded', startOpen ? 'true' : 'false');

      bell.addEventListener('click', function (event) {
        event.stopPropagation();
        var willOpen = panel.hidden;
        closePortalNotifications();
        if (!willOpen) return;
        panel.hidden = false;
        bell.setAttribute('aria-expanded', 'true');
      });
    });
    document.addEventListener('click', closePortalNotifications);
  }

  function prepareFloorLayout() {
    document.querySelectorAll('[data-floor-rows]').forEach(function (tbody) {
      var page = tbody.closest('.page');
      var below = page.querySelector('[data-floor-count="below"]');
      var above = page.querySelector('[data-floor-count="above"]');
      var summary = page.querySelector('[data-floor-summary]');
      var limit = page.querySelector('[data-floor-limit]');
      if (!below || !above) return;
      var table = tbody.closest('table');
      var countColumns = Array.prototype.map.call(table.querySelectorAll('thead [data-floor-count-column]'), function (th) {
        return { key: th.getAttribute('data-floor-count-column'), fresh: th.getAttribute('data-floor-new-value') || '0' };
      });
      var hasActions = !!table.querySelector('thead [data-floor-actions]');
      var hasStatus = !!table.querySelector('thead [data-floor-status]');
      var hasSize = !!tbody.querySelector('[data-floor-size]');
      var typed = {};
      var existing = {};
      var minBelow = 0;
      var minAbove = 1;

      tbody.querySelectorAll('tr[data-floor]').forEach(function (row) {
        var n = parseInt(row.getAttribute('data-floor'), 10);
        remember(n, row);
        var unitCell = row.querySelector('[data-floor-count="units"]');
        var units = unitCell ? parseInt(unitCell.textContent, 10) || 0 : 0;
        if (units > 0 && n >= 0) minAbove = Math.max(minAbove, n + 1);
        if (units > 0 && n < 0) minBelow = Math.max(minBelow, -n);
        existing[n] = row;
      });
      below.min = String(minBelow);
      above.min = String(minAbove);

      function remember(n, row) {
        typed[n] = typed[n] || {};
        row.querySelectorAll('input').forEach(function (input) {
          var key = input.getAttribute('data-floor-size') || 'name';
          input.addEventListener('input', function () { typed[n][key] = input.value; });
        });
      }

      function label(n) {
        return n < 0 ? '−' + -n : String(n);
      }

      function ordinal(n) {
        var tens = n % 100;
        var suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
        return n + suffix;
      }

      function placeholder(n) {
        if (n === -1) return 'e.g. Parking';
        if (n < 0) return 'e.g. Storage';
        if (n === 0) return 'e.g. Ground Floor — Reception';
        return 'e.g. ' + ordinal(n) + ' Floor';
      }

      function read(input, min, max) {
        var value = parseInt(input.value, 10);
        var tooLow = !isNaN(value) && value < min;
        input.classList.toggle('input-invalid', tooLow);
        if (isNaN(value)) return { value: min, tooLow: false };
        return { value: Math.min(max, Math.max(min, value)), tooLow: tooLow };
      }

      function sizeInput(n, axis) {
        var name = axis === 'x' ? 'width (x)' : 'depth (y)';
        return element('input', { class: 'input', type: 'number', min: '1', step: '0.1', placeholder: axis, 'aria-label': 'Floor ' + label(n) + ' ' + name + ', metres', 'data-floor-size': axis });
      }

      function newRow(n) {
        var saved = typed[n] || {};
        var cells = [
          element('td', { class: 't-mono', text: label(n) }),
          element('td', {}, [element('input', { class: 'input', type: 'text', placeholder: placeholder(n), 'aria-label': 'Name of floor ' + label(n) })])
        ];
        if (hasSize) {
          cells.push(element('td', {}, [element('div', { class: 'floor-size' }, [
            sizeInput(n, 'x'),
            element('span', { 'aria-hidden': 'true', text: '\u00d7' }),
            sizeInput(n, 'y'),
            element('span', { class: 't-hint', text: 'm' })
          ])]));
        }
        countColumns.forEach(function (column) {
          cells.push(element('td', { class: 'right num', 'data-floor-count': column.key, text: column.fresh }));
        });
        if (hasStatus) {
          cells.push(element('td', {}, [element('div', { class: 'availability-toggle' }, [
            element('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': 'true', 'aria-label': 'Floor ' + label(n) + ' available', 'data-availability-toggle': '', 'data-off-dialog': '', 'data-item-name': 'Floor ' + label(n), 'data-item-kind': 'area' }),
            element('span', { class: 'availability-label', text: 'Available' })
          ])]));
        }
        if (hasActions) cells.push(element('td', {}));
        var row = element('tr', { 'data-floor': String(n) }, cells);
        row.querySelectorAll('input').forEach(function (input) {
          input.value = saved[input.getAttribute('data-floor-size') || 'name'] || '';
        });
        remember(n, row);
        return row;
      }

      function render() {
        var belowCount = read(below, minBelow, parseInt(below.max, 10) || 9);
        var aboveCount = read(above, minAbove, parseInt(above.max, 10) || 60);
        var floors = [];
        for (var b = belowCount.value; b >= 1; b -= 1) floors.push(-b);
        for (var a = 0; a < aboveCount.value; a += 1) floors.push(a);
        tbody.innerHTML = '';
        floors.forEach(function (n) { tbody.appendChild(existing[n] || newRow(n)); });

        if (limit) {
          var messages = [];
          if (minAbove > 1) messages.push('Above ground cannot go below ' + minAbove + ' — floor ' + (minAbove - 1) + ' still has units on it.');
          if (minBelow > 0) messages.push('Below ground cannot go below ' + minBelow + ' — floor ' + label(-minBelow) + ' still has units on it.');
          limit.textContent = messages.join(' ');
          limit.hidden = !messages.length;
          limit.classList.toggle('field-error', belowCount.tooLow || aboveCount.tooLow);
        }

        if (!summary) return;
        var floorText = floors.length + (floors.length === 1 ? ' floor' : ' floors');
        if (!countColumns.length) {
          summary.textContent = floorText + ' · give each one a name and a size — units are laid out afterwards, on the floor plan.';
          return;
        }
        var parts = countColumns.map(function (column) {
          var total = 0;
          tbody.querySelectorAll('[data-floor-count="' + column.key + '"]').forEach(function (cell) { total += parseInt(cell.textContent, 10) || 0; });
          return total + ' ' + (total === 1 ? column.key.replace(/s$/, '') : column.key);
        });
        summary.textContent = [floorText].concat(parts).join(' · ');
      }

      below.addEventListener('input', render);
      above.addEventListener('input', render);
      render();
    });
  }

  function prepareCategoryProducts() {
    document.querySelectorAll('[data-category-select]').forEach(function (categorySelect) {
      var page = categorySelect.closest('.page');
      var productSelect = page.querySelector('[data-product-select]');
      var nameLabel = page.querySelector('[data-category-name]');
      var useBadge = page.querySelector('[data-category-use]');
      var target = page.querySelector('[data-layout-target]');
      if (!productSelect) return;

      function apply() {
        var category = categorySelect.value;
        var firstMatch = null;
        Array.prototype.forEach.call(productSelect.options, function (option) {
          var matches = option.getAttribute('data-category') === category;
          option.hidden = !matches;
          option.disabled = !matches;
          if (matches && !firstMatch) firstMatch = option;
        });
        if (productSelect.selectedOptions[0] && productSelect.selectedOptions[0].disabled && firstMatch) firstMatch.selected = true;
        if (nameLabel) nameLabel.textContent = category;
        showUse();
      }

      function showUse() {
        var product = productSelect.selectedOptions[0];
        var use = product ? product.getAttribute('data-use') || '' : '';
        if (useBadge) {
          useBadge.textContent = use;
          useBadge.className = 'badge ' + (use === 'Bookable' ? 'badge-info' : 'badge-neutral');
        }
        if (target) target.classList.toggle('is-bookable', use === 'Bookable');
      }

      categorySelect.addEventListener('change', apply);
      productSelect.addEventListener('change', showUse);
      apply();
    });
  }

  function prepareLayoutForms() {
    document.querySelectorAll('[data-layout-form]').forEach(function (form) {
      var page = form.closest('.page');
      var kind = form.getAttribute('data-layout-form');
      var target = page.querySelector('[data-layout-target]');
      var targetLabel = page.querySelector('[data-layout-label]');
      var nameInput = page.querySelector('[data-layout-name]');
      var container = page.querySelector('[data-layout-container]');
      var status = page.querySelector('[data-layout-status]');
      var submit = page.querySelector('[data-layout-submit]');
      var grid = target.closest('.floorplan-grid');
      var inputs = {};
      ['x', 'y', 'w', 'h'].forEach(function (key) { inputs[key] = page.querySelector('[data-layout="' + key + '"]'); });

      function rectOf(el) {
        var style = getComputedStyle(el);
        return ['--x', '--y', '--w', '--h'].map(function (prop) { return parseFloat(style.getPropertyValue(prop)) || 0; });
      }

      function metres(value) {
        return (Math.round(value * 10) / 10).toString();
      }

      function bounds() {
        if (kind === 'unit' && container) {
          var option = container.selectedOptions[0];
          var parts = option.getAttribute('data-rect').split(',').map(parseFloat);
          return { name: option.getAttribute('data-name'), rect: parts, inside: 'inside ' + option.getAttribute('data-name') };
        }
        var scale = getComputedStyle(grid.closest('.floorplan-scale'));
        return { name: 'the floor', rect: [0, 0, parseFloat(scale.getPropertyValue('--floor-x')), parseFloat(scale.getPropertyValue('--floor-y'))], inside: 'on the floor' };
      }

      function update() {
        var r = {};
        Object.keys(inputs).forEach(function (key) { r[key] = parseFloat(inputs[key].value); });
        var name = (nameInput && nameInput.value.trim()) || (kind === 'unit' ? 'New unit' : 'New space');
        if (targetLabel) targetLabel.textContent = name;
        var problems = [];
        if ([r.x, r.y, r.w, r.h].some(isNaN) || r.w <= 0 || r.h <= 0) {
          problems.push('Give it a size above 0 and a position.');
        } else {
          target.style.setProperty('--x', r.x);
          target.style.setProperty('--y', r.y);
          target.style.setProperty('--w', r.w);
          target.style.setProperty('--h', r.h);
          var box = bounds();
          var b = box.rect;
          if (r.x < b[0] || r.y < b[1] || r.x + r.w > b[0] + b[2] || r.y + r.h > b[1] + b[3]) {
            problems.push('It does not fit ' + box.inside + ' (' + metres(b[0]) + '–' + metres(b[0] + b[2]) + ' m across, ' + metres(b[1]) + '–' + metres(b[1] + b[3]) + ' m down).');
          }
          var overlaps = [];
          page.querySelectorAll('[data-layout-obstacle]').forEach(function (other) {
            var o = rectOf(other);
            if (r.x < o[0] + o[2] && o[0] < r.x + r.w && r.y < o[1] + o[3] && o[1] < r.y + r.h) overlaps.push(other.getAttribute('data-name'));
          });
          if (overlaps.length) problems.push('It overlaps ' + overlaps.join(', ') + '.');
          var stuck = [];
          page.querySelectorAll('[data-layout-contains]').forEach(function (unit) {
            var u = rectOf(unit);
            var outside = u[0] < r.x || u[1] < r.y || u[0] + u[2] > r.x + r.w || u[1] + u[3] > r.y + r.h;
            unit.classList.toggle('is-stuck', outside);
            if (outside) stuck.push(unit.getAttribute('data-name'));
          });
          if (stuck.length) {
            var list = stuck.length === 1 ? stuck[0] : stuck.slice(0, -1).join(', ') + ' and ' + stuck[stuck.length - 1];
            problems.push(list + ' would stick out of ' + name + '. Every unit has to lie fully inside one space \u2014 move ' + (stuck.length === 1 ? 'it' : 'them') + ' first, or keep the space larger.');
          }
        }
        target.classList.toggle('is-invalid', problems.length > 0);
        if (submit) submit.disabled = problems.length > 0;
        if (problems.length) {
          status.textContent = problems.join(' ');
          status.className = 'field-error';
        } else {
          status.textContent = 'Fits ' + bounds().inside + ' · ' + metres(r.w * r.h) + ' m² · no overlaps.';
          status.className = 't-hint';
        }
      }

      if (target.hasAttribute('data-layout-draggable')) {
        var drag = null;
        var floorScale = getComputedStyle(grid.closest('.floorplan-scale'));
        var floorX = parseFloat(floorScale.getPropertyValue('--floor-x'));
        var floorY = parseFloat(floorScale.getPropertyValue('--floor-y'));

        function snap(value) {
          return Math.round(value * 2) / 2;
        }

        function place(x, y) {
          var width = parseFloat(inputs.w.value) || 0;
          var depth = parseFloat(inputs.h.value) || 0;
          inputs.x.value = snap(Math.min(Math.max(x, 0), Math.max(floorX - width, 0)));
          inputs.y.value = snap(Math.min(Math.max(y, 0), Math.max(floorY - depth, 0)));
          update();
        }

        function settleSpace() {
          if (kind !== 'unit' || !container) return;
          var x = parseFloat(inputs.x.value);
          var y = parseFloat(inputs.y.value);
          var width = parseFloat(inputs.w.value);
          var depth = parseFloat(inputs.h.value);
          var fit = Array.prototype.find.call(container.options, function (option) {
            var b = option.getAttribute('data-rect').split(',').map(parseFloat);
            return x >= b[0] && y >= b[1] && x + width <= b[0] + b[2] && y + depth <= b[1] + b[3];
          });
          if (fit && !fit.selected) {
            fit.selected = true;
            update();
          }
        }

        function endDrag() {
          if (!drag) return;
          drag = null;
          target.classList.remove('is-dragging');
          settleSpace();
        }

        target.addEventListener('pointerdown', function (event) {
          if (event.button !== 0) return;
          event.preventDefault();
          target.setPointerCapture(event.pointerId);
          target.focus();
          drag = {
            px: event.clientX,
            py: event.clientY,
            x: parseFloat(inputs.x.value) || 0,
            y: parseFloat(inputs.y.value) || 0,
            scale: grid.getBoundingClientRect().width / floorX
          };
          target.classList.add('is-dragging');
        });
        target.addEventListener('pointermove', function (event) {
          if (!drag) return;
          place(drag.x + (event.clientX - drag.px) / drag.scale, drag.y + (event.clientY - drag.py) / drag.scale);
        });
        target.addEventListener('pointerup', endDrag);
        target.addEventListener('pointercancel', endDrag);
        target.addEventListener('keydown', function (event) {
          var step = event.shiftKey ? 1 : 0.5;
          var moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          var move = moves[event.key];
          if (!move) return;
          event.preventDefault();
          place((parseFloat(inputs.x.value) || 0) + move[0], (parseFloat(inputs.y.value) || 0) + move[1]);
          settleSpace();
        });
      }

      Object.keys(inputs).forEach(function (key) { inputs[key].addEventListener('input', update); });
      if (nameInput) nameInput.addEventListener('input', update);
      if (container) container.addEventListener('change', update);
      update();
    });
  }

  function prepareChoicePanels() {
    document.querySelectorAll('input[type="radio"][data-choice-group]').forEach(function (radio) {
      var scope = radio.closest('.screen') || document;
      var group = radio.getAttribute('data-choice-group');
      function apply() {
        var checked = scope.querySelector('input[type="radio"][data-choice-group="' + group + '"]:checked');
        scope.querySelectorAll('[data-choice-panel^="' + group + ':"]').forEach(function (panel) {
          panel.hidden = !checked || panel.getAttribute('data-choice-panel') !== group + ':' + checked.value;
        });
      }
      radio.addEventListener('change', apply);
      apply();
    });
  }

  function prepareProposalToggles() {
    document.querySelectorAll('[data-proposal-toggle]').forEach(function (box) {
      var scope = box.closest('.screen') || document;
      function apply() {
        scope.querySelectorAll('[data-proposal-only]').forEach(function (el) { el.hidden = !box.checked; });
        scope.querySelectorAll('[data-direct-only]').forEach(function (el) { el.hidden = box.checked; });
      }
      box.addEventListener('change', apply);
      apply();
    });
  }

  function prepareSwitches() {
    document.querySelectorAll('.switch[data-switch]').forEach(function (toggle) {
      function apply() {
        var on = toggle.getAttribute('aria-checked') === 'true';
        var controls = toggle.getAttribute('data-controls');
        if (controls) {
          var target = document.getElementById(controls);
          if (target) target.hidden = !on;
        }
        var controlsOff = toggle.getAttribute('data-controls-off');
        if (controlsOff) {
          var details = document.getElementById(controlsOff);
          if (details) details.hidden = on;
        }
        var label = toggle.parentElement.querySelector('.availability-label');
        if (label) label.textContent = on ? 'Available' : 'Unavailable';
        var row = toggle.closest('.hours-row');
        if (row) row.classList.toggle('is-closed', !on);
      }
      toggle.addEventListener('click', function () {
        toggle.setAttribute('aria-checked', toggle.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
        apply();
      });
      apply();
    });
  }

  function openAvailabilityDialog(toggle) {
    var app = toggle.closest('.app');
    if (!app || app.querySelector('.availability-dialog')) return;
    var name = toggle.getAttribute('data-item-name') || 'this item';
    var summary = toggle.getAttribute('data-off-summary');
    var reason = element('input', { class: 'input', type: 'text', placeholder: 'e.g. Renovation', 'aria-label': 'Reason' });
    var from = element('input', { class: 'input', type: 'text', value: '3 Sep 2026', 'aria-label': 'Unavailable from', style: 'max-width:11rem' });
    var until = element('input', { class: 'input', type: 'text', placeholder: 'Open-ended', 'aria-label': 'Until', style: 'max-width:11rem' });
    var confirm = element('button', { class: 'btn btn-destructive', type: 'button', disabled: '' }, [document.createTextNode('Make unavailable')]);
    var cancel = element('button', { class: 'btn btn-outline', type: 'button', text: 'Cancel' });
    var dialog = element('div', { class: 'modal availability-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Make ' + name + ' unavailable' }, [
      element('div', { class: 'modal-head' }, [
        element('div', { class: 'col', style: 'gap:0.25rem' }, [
          element('h3', { class: 't-section', text: 'Make ' + name + ' unavailable?' }),
          element('span', { class: 't-hint', text: toggle.getAttribute('data-item-kind') === 'unit' ? 'It takes no new leases or bookings while it is unavailable.' : 'Its units take no new leases or bookings while it is unavailable.' })
        ])
      ]),
      element('div', { class: 'modal-body' }, [
        element('div', { class: 'field' }, [element('label', {}, [document.createTextNode('Reason '), element('span', { class: 'req', text: '*' })]), reason]),
        element('div', { class: 'row-4 wrap' }, [
          element('div', { class: 'field' }, [element('label', {}, [document.createTextNode('From '), element('span', { class: 'req', text: '*' })]), from]),
          element('div', { class: 'field' }, [element('label', { text: 'Until' }), until])
        ]),
        element('div', { class: 'alert alert-warning' }, [element('div', {}, [
          element('span', { class: 'alert-title', text: summary ? 'This touches ' + summary : 'Bookings in that period are cancelled' }),
          element('div', { class: 't-hint', text: 'Bookings in that period are cancelled and their customers notified. Active leases stay, flagged "Unit unavailable" on the Leases list.' })
        ])])
      ]),
      element('div', { class: 'modal-foot' }, [
        element('span', { class: 't-hint', text: 'Esc to cancel · ⌘↵ to confirm' }),
        element('div', { class: 'row' }, [cancel, confirm])
      ])
    ]);

    function close() {
      dialog.remove();
      app.classList.remove('modal-scrim');
      document.removeEventListener('keydown', onKey, true);
      toggle.focus();
    }

    function apply() {
      if (!reason.value.trim()) return;
      toggle.setAttribute('aria-checked', 'false');
      var label = toggle.parentElement.querySelector('.availability-label');
      if (label) label.textContent = 'Unavailable';
      var cell = toggle.closest('td');
      var hint = cell.querySelector('.availability-hint');
      if (!hint) {
        hint = element('span', { class: 't-hint availability-hint' });
        cell.appendChild(hint);
      }
      hint.textContent = reason.value.trim() + (until.value.trim() ? ' · until ' + until.value.trim() : ' · from ' + (from.value.trim() || 'today'));
      hint.hidden = false;
      close();
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        apply();
      }
    }

    reason.addEventListener('input', function () {
      if (reason.value.trim()) confirm.removeAttribute('disabled');
      else confirm.setAttribute('disabled', '');
    });
    cancel.addEventListener('click', close);
    confirm.addEventListener('click', apply);
    document.addEventListener('keydown', onKey, true);
    app.classList.add('modal-scrim');
    app.appendChild(dialog);
    reason.focus();
  }

  function prepareAvailabilityToggles() {
    document.addEventListener('click', function (event) {
      var toggle = event.target.closest('[data-availability-toggle]');
      if (!toggle) return;
      event.preventDefault();
      if (toggle.getAttribute('aria-checked') === 'true') {
        if (toggle.hasAttribute('data-off-dialog')) {
          openAvailabilityDialog(toggle);
          return;
        }
        var target = toggle.getAttribute('data-off-goto');
        if (target) goTo(target);
        return;
      }
      toggle.setAttribute('aria-checked', 'true');
      var label = toggle.parentElement.querySelector('.availability-label');
      if (label) label.textContent = 'Available';
      var hint = toggle.closest('td') && toggle.closest('td').querySelector('.availability-hint');
      if (hint) hint.hidden = true;
    });
  }

  function prepareTableFilters() {
    document.querySelectorAll('[data-filterable]').forEach(function (container) {
      var rows = Array.prototype.slice.call(container.querySelectorAll('tbody > tr'));
      if (!rows.length) return;
      var search = container.querySelector('[data-filter-search]');
      var select = container.querySelector('[data-filter-select]');
      var chips = Array.prototype.slice.call(container.querySelectorAll('[data-filter-chip]'));
      var status = container.querySelector('[data-filter-count]');
      var blank = container.querySelector('[data-filter-blank]');
      var noun = container.getAttribute('data-filterable') || 'rows';
      var state = { text: '', select: '', chip: chips.length ? chips[0].getAttribute('data-filter-chip') : '' };

      function haystack(row) {
        if (!row.dataset.haystack) row.dataset.haystack = row.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
        return row.dataset.haystack;
      }

      function apply() {
        var shown = 0;
        rows.forEach(function (row) {
          var okText = !state.text || haystack(row).indexOf(state.text) !== -1;
          var okSelect = !state.select || row.getAttribute('data-location') === state.select;
          var okChip = !state.chip || state.chip === 'all' || (row.getAttribute('data-state') || '').split(' ').indexOf(state.chip) !== -1;
          var visible = okText && okSelect && okChip;
          row.hidden = !visible;
          if (visible) shown += 1;
        });
        if (status) status.textContent = shown === rows.length
          ? rows.length + ' ' + noun
          : shown + ' of ' + rows.length + ' ' + noun;
        if (blank) blank.hidden = shown !== 0;
      }

      if (search) {
        search.addEventListener('input', function () {
          state.text = search.value.trim().toLowerCase();
          apply();
        });
      }
      if (select) {
        select.addEventListener('change', function () {
          state.select = select.value === 'all' ? '' : select.value;
          apply();
        });
      }
      chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
          chips.forEach(function (other) { other.classList.toggle('chip-active', other === chip); other.setAttribute('aria-pressed', other === chip ? 'true' : 'false'); });
          state.chip = chip.getAttribute('data-filter-chip');
          apply();
        });
      });
      apply();
    });
  }

  function closeScreenMenu() {
    var menu = document.getElementById('screen-menu');
    var toggle = document.getElementById('screen-menu-toggle');
    if (menu) menu.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function prepareScreenMenu() {
    var menu = document.getElementById('screen-menu');
    var toggle = document.getElementById('screen-menu-toggle');
    if (!menu || !toggle) return;
    var groups = Array.prototype.slice.call(menu.querySelectorAll('.screen-menu-group'));

    function setGroup(group, open) {
      var head = group.querySelector('.screen-menu-head');
      var items = group.querySelector('.screen-menu-items');
      if (!head || !items) return;
      items.hidden = !open;
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function currentScreenId() {
      var focused = document.querySelector('.screen.is-current');
      if (focusMode && focused) return focused.id;
      var best = null;
      screens().forEach(function (screen) {
        var top = screen.getBoundingClientRect().top;
        if (top <= 120) best = screen.id;
      });
      return best || (screens()[0] || {}).id;
    }

    function markCurrent() {
      var id = currentScreenId();
      menu.querySelectorAll('.screen-menu-items a').forEach(function (link) {
        link.classList.toggle('is-current', link.getAttribute('data-screen') === id);
      });
      return id;
    }

    groups.forEach(function (group) {
      var head = group.querySelector('.screen-menu-head');
      head.addEventListener('click', function (event) {
        event.stopPropagation();
        var open = head.getAttribute('aria-expanded') !== 'true';
        groups.forEach(function (other) { setGroup(other, other === group && open); });
      });
      group.querySelectorAll('.screen-menu-items a').forEach(function (link) {
        link.addEventListener('click', function (event) {
          event.preventDefault();
          closeScreenMenu();
          goTo(link.getAttribute('data-screen'));
        });
      });
      setGroup(group, false);
    });

    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) return;
      var id = markCurrent();
      var active = menu.querySelector('.screen-menu-items a.is-current');
      groups.forEach(function (group) {
        setGroup(group, !!active && group.contains(active));
      });
      if (active) menu.scrollTop = Math.max(0, active.offsetTop - menu.clientHeight / 2);
    });

    menu.addEventListener('click', function (event) { event.stopPropagation(); });
    document.addEventListener('click', closeScreenMenu);
  }

  var accessCards = [];

  function syncAccessCodes() {
    accessCards.forEach(function (card) { card.sync(); });
  }

  function prepareAccessCodes() {
    accessCards = [];
    document.querySelectorAll('[data-access-code]').forEach(function (card) {
      var total = parseInt(card.getAttribute('data-access-code'), 10) || 60;
      var valueEl = card.querySelector('[data-access-timer]');
      var barEl = card.querySelector('[data-access-bar]');
      var veil = card.querySelector('[data-access-veil]');
      var hintEl = card.querySelector('[data-access-hint]');
      var renew = card.querySelector('[data-access-renew]');
      var ticker = null;
      var left = total;

      function paint() {
        var expired = left <= 0;
        if (valueEl) {
          var secs = left % 60;
          valueEl.textContent = expired ? 'Expired' : Math.floor(left / 60) + ':' + (secs < 10 ? '0' : '') + secs;
        }
        if (barEl) barEl.style.width = (expired ? 0 : (left / total) * 100) + '%';
        if (veil) veil.hidden = !expired;
        if (hintEl) hintEl.textContent = expired ? 'This code can no longer open a door' : 'until this code expires';
        card.classList.toggle('is-expired', expired);
      }

      function stop() {
        if (!ticker) return;
        clearInterval(ticker);
        ticker = null;
      }

      function start() {
        stop();
        left = total;
        paint();
        ticker = setInterval(function () {
          left -= 1;
          if (left < 0) left = 0;
          paint();
          if (left === 0) stop();
        }, 1000);
      }

      if (card.hasAttribute('data-access-expired')) {
        left = 0;
        paint();
        return;
      }

      if (renew) renew.addEventListener('click', function (event) { event.preventDefault(); start(); });

      /* The countdown runs only while the card is on screen, so a reviewer
         scrolling to it always finds a live timer rather than one that ran out
         a minute after the page loaded. Plain geometry rather than an
         IntersectionObserver: the observer never fires in some automated
         browsers, and this has to work wherever the file is opened. */
      function visible() {
        var box = card.getBoundingClientRect();
        var shown = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
        return box.height > 0 && shown / box.height >= 0.35;
      }

      paint();
      accessCards.push({
        sync: function () {
          if (visible()) {
            if (!ticker && left > 0) start();
          } else if (ticker) {
            stop();
            left = total;
            paint();
          }
        }
      });
    });
    syncAccessCodes();
  }

  function buildToolbar() {
    var bar = document.querySelector('.doc-toolbar');
    if (!bar) return;
    clickModeButton = element('button', { type: 'button', text: 'Clickable', onclick: function () { setMode('click'); } });
    commentModeButton = element('button', { type: 'button', text: 'Comment', onclick: function () { setMode('comment'); } });
    var segmented = element('div', { class: 'segmented' }, [clickModeButton, commentModeButton]);
    var hintsButton = element('button', { class: 'btn btn-outline btn-sm', type: 'button', text: 'Show hotspots', onclick: function () {
      hints = !hints;
      document.body.classList.toggle('proto-hints', hints);
      hintsButton.textContent = hints ? 'Hide hotspots' : 'Show hotspots';
    } });
    var focusButton = element('button', { class: 'btn btn-outline btn-sm', type: 'button', text: 'Presentation', onclick: function () {
      focusMode = !focusMode;
      document.body.classList.toggle('proto-focus', focusMode);
      focusButton.className = 'btn btn-sm ' + (focusMode ? 'btn-primary' : 'btn-outline');
      if (focusMode && !document.querySelector('.screen.is-current')) {
        var firstScreen = screens()[0];
        if (firstScreen) firstScreen.classList.add('is-current');
      }
      updateBackButton();
    } });
    var threadsButton = element('button', { class: 'btn btn-outline btn-sm', type: 'button', text: 'Threads', onclick: function () {
      panel.classList.contains('open') ? closePanel() : openPanel();
    } });
    var pinsButton = element('button', { class: 'btn btn-outline btn-sm', type: 'button', text: 'Hide pins', onclick: function () {
      pinsVisible = !pinsVisible;
      document.body.classList.toggle('anno-hidden', !pinsVisible);
      pinsButton.textContent = pinsVisible ? 'Hide pins' : 'Show pins';
    } });
    var group = element('div', { class: 'proto-toolbar' }, [segmented, hintsButton, focusButton, threadsButton, pinsButton]);
    var themeButton = document.getElementById('theme-toggle');
    if (themeButton) {
      bar.insertBefore(group, themeButton);
      themeButton.style.marginLeft = '0';
    } else {
      bar.appendChild(group);
    }
    setMode('click');
  }

  function buildBackButton() {
    document.body.appendChild(element('button', {
      class: 'btn btn-outline proto-back', type: 'button', text: '← Back', onclick: goBack
    }));
    updateBackButton();
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyOperations();
    buildPanel();
    buildToolbar();
    buildBackButton();
    preparePortalNotifications();
    prepareHotspots();
    prepareLocationSwitchers();
    prepareViewSwitches();
    preparePagination();
    prepareTableFilters();
    prepareFloorLayout();
    prepareSwitches();
    prepareProposalToggles();
    prepareChoicePanels();
    prepareAvailabilityToggles();
    prepareCategoryProducts();
    prepareLayoutForms();
    prepareScreenMenu();
    prepareAccessCodes();
    renderPins();
    document.addEventListener('click', onDocumentClick, true);
    window.addEventListener('resize', renderPins);
    window.addEventListener('scroll', renderPins, true);
    window.addEventListener('scroll', syncAccessCodes, true);
    window.addEventListener('resize', syncAccessCodes);
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && reanchorThreadId) {
        reanchorThreadId = null;
        setMode('click');
        flashToast('Re-anchor cancelled.');
        return;
      }
      if (event.key === 'Escape' && panel.classList.contains('open')) closePanel();
      if (event.key === 'Escape') closeLocationSwitchers();
      if (event.key === 'Escape') closePortalNotifications();
      if (event.key === 'Escape') closeScreenMenu();
      if (event.key === 'Backspace' && focusMode && event.target === document.body) {
        event.preventDefault();
        goBack();
      }
    });
  });
})();
