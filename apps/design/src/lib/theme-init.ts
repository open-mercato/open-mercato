export const DARK_MODE_STORAGE_KEY = 'om-design-mode'
export const PREVIEW_THEME_STORAGE_KEY = 'om-design-preview-theme'

export const THEME_INIT_SCRIPT = `
(function () {
  try {
    if (location.pathname.startsWith('/preview/')) {
      const query = new URLSearchParams(location.search);
      const root = document.documentElement;
      const dark = query.get('mode') === 'dark';
      root.classList.toggle('dark', dark);
      root.style.colorScheme = dark ? 'dark' : 'light';
      if (query.get('theme') === 'storefront') root.dataset.theme = 'storefront';
      return;
    }
    if (localStorage.getItem(${JSON.stringify(DARK_MODE_STORAGE_KEY)}) === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (error) {}
})();
`
