export const DARK_MODE_STORAGE_KEY = 'om-design-mode'

export const THEME_INIT_SCRIPT = `
(function () {
  try {
    if (location.pathname.startsWith('/preview/')) {
      const query = new URLSearchParams(location.search);
      const root = document.documentElement;
      const dark = query.get('mode') === 'dark';
      root.classList.toggle('dark', dark);
      root.style.colorScheme = dark ? 'dark' : 'light';
      return;
    }
    if (localStorage.getItem(${JSON.stringify(DARK_MODE_STORAGE_KEY)}) === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (error) {}
})();
`
