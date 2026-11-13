/* Silnik prototypu: tryb klikalny + tryb komentarzy.
 *
 * TRYB KLIKALNY (domyślny)
 *   Elementy z atrybutem data-goto="<id-ekranu>" są hotspotami — kliknięcie
 *   przenosi na wskazany ekran. "Prezentacja" pokazuje jeden ekran naraz,
 *   dzięki czemu przeklikanie przypomina prawdziwą aplikację.
 *
 * TRYB KOMENTARZY
 *   Kliknięcie dowolnego elementu przypina wątek w tym miejscu.
 *
 * Obieg komentarzy (brak współdzielonego backendu — świadome ograniczenie):
 *   piszesz → localStorage → "Eksportuj do repo" → comments.js → commit/PR
 * Wątki jeszcze niewyeksportowane są oznaczone, żeby nikt nie myślał,
 * że zespół już je widzi.
 */
(function () {
  'use strict';

  var LS_THREADS = 'om-mockup-comments';
  var LS_AUTHOR = 'om-mockup-author';

  var committed = (window.__OM_MOCKUP_COMMENTS__ || []).slice();
  var threads = merge(committed, load(LS_THREADS, []));
  var author = load(LS_AUTHOR, '');

  var mode = 'click';        // 'click' | 'comment'
  var focusMode = false;
  var hints = false;
  var pinsVisible = true;
  var activeId = null;
  var pending = null;
  var history = [];

  // ── Pomocnicze ────────────────────────────────────────────────

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) { return fallback; }
  }

  function save() {
    try {
      localStorage.setItem(LS_THREADS, JSON.stringify(threads));
      localStorage.setItem(LS_AUTHOR, JSON.stringify(author));
    } catch (err) { /* tryb prywatny — komentarze zostają w pamięci sesji */ }
  }

  function merge(base, extra) {
    var byId = {}, order = [];
    base.concat(extra).forEach(function (thread) {
      if (!thread || !thread.id) return;
      if (!byId[thread.id]) order.push(thread.id);
      byId[thread.id] = thread;
    });
    return order.map(function (id) { return byId[id]; });
  }

  function isDirty(thread) {
    for (var i = 0; i < committed.length; i++) {
      if (committed[i].id === thread.id) {
        return JSON.stringify(committed[i]) !== JSON.stringify(thread);
      }
    }
    return true;
  }

  function el(tag, props, kids) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (key === 'class') node.className = props[key];
      else if (key === 'text') node.textContent = props[key];
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), props[key]);
      else node.setAttribute(key, props[key]);
    });
    (kids || []).forEach(function (kid) { if (kid) node.appendChild(kid); });
    return node;
  }

  function nowStamp() {
    var d = new Date();
    function pad(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function newId() {
    return 'c-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function screens() {
    return Array.prototype.slice.call(document.querySelectorAll('.screen'));
  }

  // ── Nawigacja (tryb klikalny) ─────────────────────────────────

  function goTo(screenId, record) {
    var target = document.getElementById(screenId);
    if (!target) {
      flashToast('Ten ekran nie istnieje w prototypie: ' + screenId);
      return;
    }
    if (record !== false) {
      var current = document.querySelector('.screen.is-current');
      if (current && current.id !== screenId) history.push(current.id);
    }

    if (focusMode) {
      screens().forEach(function (s) { s.classList.remove('is-current'); });
      target.classList.add('is-current');
      window.scrollTo(0, 0);
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    target.classList.remove('proto-arrived');
    void target.offsetWidth;
    target.classList.add('proto-arrived');
    updateBack();
  }

  function goBack() {
    var previous = history.pop();
    if (previous) goTo(previous, false);
    updateBack();
  }

  function updateBack() {
    var btn = document.querySelector('.proto-back');
    if (btn) btn.disabled = history.length === 0;
  }

  var toastTimer;
  function flashToast(text) {
    var existing = document.querySelector('.proto-toast');
    if (existing) existing.remove();
    var toast = el('div', { class: 'toast proto-toast', text: text });
    toast.style.position = 'fixed';
    toast.style.right = '1rem';
    toast.style.bottom = '1rem';
    toast.style.zIndex = 'var(--z-index-toast)';
    document.body.appendChild(toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.remove(); }, 2600);
  }

  // ── Kotwice komentarzy ────────────────────────────────────────
  // Ścieżka pozycyjna względem sekcji ekranu. Gdy struktura się zmieni,
  // wątek trafia na listę osieroconych zamiast zniknąć.

  function anchorFor(node, screenEl) {
    var parts = [];
    while (node && node !== screenEl) {
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

  function resolveAnchor(screenEl, path) {
    if (!path) return null;
    var node = screenEl;
    var parts = path.split('>');
    for (var i = 0; i < parts.length; i++) {
      var bits = parts[i].split(':');
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

  // ── Pinezki ───────────────────────────────────────────────────

  function clearPins() {
    document.querySelectorAll('.anno-pin').forEach(function (pin) { pin.remove(); });
    document.querySelectorAll('.anno-host').forEach(function (h) { h.classList.remove('anno-host'); });
    document.querySelectorAll('.anno-target-active').forEach(function (n) {
      n.classList.remove('anno-target-active');
    });
  }

  function renderPins() {
    clearPins();
    var orphans = [];
    var counters = {};

    threads.forEach(function (thread) {
      var screenEl = document.getElementById(thread.screen);
      if (!screenEl) { orphans.push(thread); return; }

      counters[thread.screen] = (counters[thread.screen] || 0) + 1;
      thread._num = counters[thread.screen];

      if (!thread.anchor) { thread._orphan = false; return; }

      var target = resolveAnchor(screenEl, thread.anchor);
      if (!target) { thread._orphan = true; orphans.push(thread); return; }
      thread._orphan = false;

      if (getComputedStyle(target).position === 'static') target.classList.add('anno-host');

      var classes = ['anno-pin'];
      if (thread.resolved) classes.push('resolved');
      else if (isDirty(thread)) classes.push('unsaved');

      target.appendChild(el('button', {
        class: classes.join(' '),
        type: 'button',
        title: (thread.messages[0] || {}).text || '',
        'aria-label': 'Komentarz ' + thread._num,
        text: String(thread._num),
        onclick: function (event) {
          event.preventDefault();
          event.stopPropagation();
          activeId = thread.id;
          openPanel();
        }
      }));

      if (thread.id === activeId) target.classList.add('anno-target-active');
    });

    window.__protoOrphans = orphans;
    renderNavCounts();
  }

  function renderNavCounts() {
    document.querySelectorAll('.screen-nav a').forEach(function (link) {
      var old = link.querySelector('.anno-count');
      if (old) old.remove();
      var id = link.getAttribute('href').slice(1);
      var open = threads.filter(function (t) { return t.screen === id && !t.resolved; }).length;
      if (open) link.appendChild(el('span', { class: 'anno-count', text: String(open) }));
    });
  }

  // ── Panel ─────────────────────────────────────────────────────

  var panel, panelBody, authorInput;

  function buildPanel() {
    panelBody = el('div', { class: 'anno-panel-body' });
    authorInput = el('input', {
      class: 'input',
      placeholder: 'Twoje imię — pojawi się przy komentarzach',
      value: author || '',
      oninput: function (event) { author = event.target.value; save(); }
    });

    panel = el('aside', { class: 'anno-panel', 'aria-label': 'Komentarze do prototypu' }, [
      el('div', { class: 'anno-panel-head' }, [
        el('strong', { class: 't-card-title', text: 'Komentarze' }),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Zamknij', onclick: closePanel })
      ]),
      panelBody,
      el('div', { class: 'anno-panel-foot' }, [
        authorInput,
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Eksportuj do repo', onclick: exportRepo }),
          el('button', { class: 'btn btn-outline btn-sm', type: 'button', text: 'Eksportuj Markdown', onclick: exportMarkdown })
        ])
      ])
    ]);
    document.body.appendChild(panel);
  }

  function openPanel() {
    panel.classList.add('open');
    document.body.classList.add('anno-open');
    renderPanel();
    renderPins();
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

    var dirty = threads.filter(isDirty).length;
    if (dirty) {
      panelBody.appendChild(el('div', {
        class: 'anno-dirty-note',
        text: dirty + (dirty === 1 ? ' wątek jest tylko u Ciebie' : ' wątki są tylko u Ciebie') +
          ' — wyeksportuj i zacommituj comments.js, żeby zobaczył je zespół.'
      }));
    }

    var visible = threads.filter(function (t) { return !t._orphan; });
    if (!visible.length && !pending) {
      panelBody.appendChild(el('div', {
        class: 'anno-empty',
        text: 'Brak komentarzy. Przełącz na tryb "Komentarze" i kliknij dowolny element, żeby przypiąć uwagę.'
      }));
    }

    var byScreen = {};
    visible.forEach(function (t) { (byScreen[t.screen] = byScreen[t.screen] || []).push(t); });

    Object.keys(byScreen).forEach(function (screenId) {
      var heading = document.querySelector('#' + screenId + ' .screen-meta h2');
      panelBody.appendChild(el('div', { class: 't-overline', text: heading ? heading.textContent : screenId }));
      byScreen[screenId].forEach(function (t) { panelBody.appendChild(threadCard(t)); });
    });

    var orphans = window.__protoOrphans || [];
    if (orphans.length) {
      var box = el('div', { class: 'anno-orphans' }, [
        el('strong', { class: 't-card-title', text: 'Odklejone wątki (' + orphans.length + ')' }),
        el('div', {
          class: 't-hint',
          text: 'Element, do którego były przypięte, zniknął po edycji mockupu. Treść jest zachowana — przypnij ponownie albo zamknij wątek.'
        })
      ]);
      orphans.forEach(function (t) { box.appendChild(threadCard(t)); });
      panelBody.appendChild(box);
    }

    var active = panelBody.querySelector('.anno-thread.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function composerCard() {
    var box = el('textarea', { placeholder: 'Co jest nie tak / co zmienić?' });
    var card = el('div', { class: 'anno-thread active' }, [
      el('div', { class: 'anno-thread-head' }, [
        el('span', { class: 'anno-num', text: '+' }),
        el('span', { class: 'anno-anchor', text: pending.label })
      ]),
      el('div', { class: 'anno-composer' }, [
        box,
        el('div', { class: 'anno-composer-actions' }, [
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Dodaj komentarz', onclick: function () { commitNew(box.value); } }),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Anuluj', onclick: function () { pending = null; renderPanel(); renderPins(); } })
        ])
      ])
    ]);
    box.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commitNew(box.value);
      if (event.key === 'Escape') { pending = null; renderPanel(); renderPins(); }
    });
    setTimeout(function () { box.focus(); }, 0);
    return card;
  }

  function commitNew(text) {
    if (!text.trim()) return;
    var thread = {
      id: newId(),
      screen: pending.screen,
      anchor: pending.anchor,
      label: pending.label,
      resolved: false,
      messages: [{ author: author || 'anonim', text: text.trim(), at: nowStamp() }]
    };
    threads.push(thread);
    pending = null;
    activeId = thread.id;
    save(); renderPins(); renderPanel();
  }

  function threadCard(thread) {
    var classes = ['anno-thread'];
    if (thread.id === activeId) classes.push('active');
    if (thread.resolved) classes.push('resolved');

    var card = el('div', {
      class: classes.join(' '),
      onclick: function () {
        activeId = thread.id;
        renderPins(); renderPanel();
        if (focusMode) goTo(thread.screen);
        else {
          var screenEl = document.getElementById(thread.screen);
          if (screenEl) screenEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }, [
      el('div', { class: 'anno-thread-head' }, [
        el('span', { class: 'anno-num', text: String(thread._num || '?') }),
        el('span', { class: 'anno-anchor', title: thread.label, text: thread.label }),
        isDirty(thread) ? el('span', { class: 'badge badge-warning', text: 'lokalny' }) : null
      ])
    ]);

    thread.messages.forEach(function (msg) {
      card.appendChild(el('div', { class: 'anno-msg' }, [
        el('div', { class: 'anno-msg-meta' }, [
          el('span', { class: 'who', text: msg.author }),
          el('span', { text: msg.at })
        ]),
        el('div', { class: 'anno-msg-text', text: msg.text })
      ]));
    });

    if (thread.id === activeId) {
      var reply = el('textarea', { placeholder: 'Odpowiedz…' });
      reply.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) addReply(thread, reply.value);
      });
      card.appendChild(el('div', { class: 'anno-composer' }, [
        reply,
        el('div', { class: 'anno-composer-actions' }, [
          el('button', {
            class: 'btn btn-outline btn-sm', type: 'button', text: 'Odpowiedz',
            onclick: function (e) { e.stopPropagation(); addReply(thread, reply.value); }
          }),
          el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            text: thread.resolved ? 'Otwórz ponownie' : 'Zamknij wątek',
            onclick: function (e) {
              e.stopPropagation();
              thread.resolved = !thread.resolved;
              save(); renderPins(); renderPanel();
            }
          }),
          el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', text: 'Usuń',
            onclick: function (e) {
              e.stopPropagation();
              if (!confirm('Usunąć ten wątek? Nie da się tego cofnąć.')) return;
              threads = threads.filter(function (t) { return t.id !== thread.id; });
              activeId = null;
              save(); renderPins(); renderPanel();
            }
          })
        ])
      ]));
    }
    return card;
  }

  function addReply(thread, text) {
    if (!text.trim()) return;
    thread.messages.push({ author: author || 'anonim', text: text.trim(), at: nowStamp() });
    save(); renderPins(); renderPanel();
  }

  // ── Eksport ───────────────────────────────────────────────────

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = el('a', { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportRepo() {
    var clean = threads.map(function (t) {
      return { id: t.id, screen: t.screen, anchor: t.anchor, label: t.label, resolved: !!t.resolved, messages: t.messages };
    });
    var header = [
      '/* Zatwierdzone wątki komentarzy — plik commitowany do repo.',
      ' *',
      ' * Wygenerowane przez "Eksportuj do repo" w prototypie. Podmień ten plik',
      ' * i zacommituj, żeby wątki zobaczył cały zespół.',
      ' */',
      'window.__OM_MOCKUP_COMMENTS__ = '
    ].join('\n');
    download('comments.js', header + JSON.stringify(clean, null, 2) + ';\n', 'text/javascript');
  }

  function exportMarkdown() {
    var title = (document.querySelector('.doc-head h1') || {}).textContent || 'Prototyp';
    var lines = ['# Uwagi do prototypu — ' + title, ''];
    var byScreen = {};
    threads.forEach(function (t) { (byScreen[t.screen] = byScreen[t.screen] || []).push(t); });
    Object.keys(byScreen).forEach(function (screenId) {
      var heading = document.querySelector('#' + screenId + ' .screen-meta h2');
      lines.push('## ' + (heading ? heading.textContent : screenId), '');
      byScreen[screenId].forEach(function (t) {
        lines.push('- **' + (t.label || 'ekran') + '**' + (t.resolved ? ' _(zamknięty)_' : ''));
        t.messages.forEach(function (m) {
          lines.push('  - ' + m.author + ' (' + m.at + '): ' + m.text.replace(/\n/g, ' '));
        });
        lines.push('');
      });
    });
    download('uwagi-prototyp.md', lines.join('\n'), 'text/markdown');
  }

  // ── Obsługa kliknięć ──────────────────────────────────────────

  function onDocClick(event) {
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
      if (!target) return;

      var screenEl = target.closest('.screen');
      if (!screenEl) return;

      pending = { screen: screenEl.id, anchor: anchorFor(target, screenEl), label: labelFor(target) };
      activeId = null;
      openPanel();
      return;
    }

    // tryb klikalny — hotspot prowadzi na inny ekran
    var hotspot = event.target.closest('[data-goto]');
    if (hotspot) {
      event.preventDefault();
      goTo(hotspot.getAttribute('data-goto'));
    }
  }

  // ── Pasek narzędzi ────────────────────────────────────────────

  function buildToolbar() {
    var bar = document.querySelector('.doc-toolbar');
    if (!bar) return;

    var clickBtn, commentBtn;

    function setMode(next) {
      mode = next;
      document.body.classList.toggle('proto-comment', mode === 'comment');
      document.body.classList.toggle('proto-click', mode === 'click');
      clickBtn.setAttribute('aria-selected', String(mode === 'click'));
      commentBtn.setAttribute('aria-selected', String(mode === 'comment'));
      if (mode === 'comment') openPanel();
    }

    clickBtn = el('button', { type: 'button', text: 'Klikalny', onclick: function () { setMode('click'); } });
    commentBtn = el('button', { type: 'button', text: 'Komentarze', onclick: function () { setMode('comment'); } });
    var segmented = el('div', { class: 'segmented' }, [clickBtn, commentBtn]);

    var hintBtn = el('button', {
      class: 'btn btn-outline btn-sm', type: 'button', text: 'Pokaż klikalne',
      onclick: function () {
        hints = !hints;
        document.body.classList.toggle('proto-hints', hints);
        hintBtn.textContent = hints ? 'Ukryj klikalne' : 'Pokaż klikalne';
      }
    });

    var focusBtn = el('button', {
      class: 'btn btn-outline btn-sm', type: 'button', text: 'Prezentacja',
      onclick: function () {
        focusMode = !focusMode;
        document.body.classList.toggle('proto-focus', focusMode);
        focusBtn.className = 'btn btn-sm ' + (focusMode ? 'btn-primary' : 'btn-outline');
        if (focusMode && !document.querySelector('.screen.is-current')) {
          var first = screens()[0];
          if (first) first.classList.add('is-current');
        }
        updateBack();
      }
    });

    var threadsBtn = el('button', {
      class: 'btn btn-outline btn-sm', type: 'button', text: 'Wątki',
      onclick: function () { panel.classList.contains('open') ? closePanel() : openPanel(); }
    });

    var pinsBtn = el('button', {
      class: 'btn btn-outline btn-sm', type: 'button', text: 'Ukryj pinezki',
      onclick: function () {
        pinsVisible = !pinsVisible;
        document.body.classList.toggle('anno-hidden', !pinsVisible);
        pinsBtn.textContent = pinsVisible ? 'Ukryj pinezki' : 'Pokaż pinezki';
      }
    });

    var group = el('div', { class: 'proto-toolbar' }, [segmented, hintBtn, focusBtn, threadsBtn, pinsBtn]);
    var themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) { bar.insertBefore(group, themeBtn); themeBtn.style.marginLeft = '0'; }
    else bar.appendChild(group);

    setMode('click');
  }

  function buildBackButton() {
    var back = el('button', {
      class: 'btn btn-outline proto-back', type: 'button', text: '← Wstecz', onclick: goBack
    });
    document.body.appendChild(back);
    updateBack();
  }

  document.addEventListener('DOMContentLoaded', function () {
    buildToolbar();
    buildPanel();
    buildBackButton();
    renderPins();
    document.addEventListener('click', onDocClick, true);
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && panel.classList.contains('open')) closePanel();
      if (event.key === 'Backspace' && focusMode && event.target === document.body) {
        event.preventDefault();
        goBack();
      }
    });
  });
})();
