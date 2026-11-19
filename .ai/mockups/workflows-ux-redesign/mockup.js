// Theme toggle + active screen-nav highlighting. Nothing else — static mockups.
(function () {
  var root = document.documentElement;
  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      root.classList.toggle('dark');
      toggle.setAttribute('aria-pressed', root.classList.contains('dark') ? 'true' : 'false');
    });
  }

  var links = Array.prototype.slice.call(document.querySelectorAll('.screen-nav a'));
  var screens = Array.prototype.slice.call(document.querySelectorAll('.screen'));
  if ('IntersectionObserver' in window && links.length && screens.length) {
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          links.forEach(function (a) { a.classList.remove('active'); });
          var link = byId[entry.target.id];
          if (link) link.classList.add('active');
        }
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    screens.forEach(function (s) { observer.observe(s); });
  }
})();
