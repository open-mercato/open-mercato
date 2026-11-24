export const DARK_MODE_STORAGE_KEY = 'om-design-mode'
export const PREVIEW_THEME_STORAGE_KEY = 'om-design-preview-theme'

export const THEME_INIT_SCRIPT = `
(function () {
  try {
    if (localStorage.getItem(${JSON.stringify(DARK_MODE_STORAGE_KEY)}) === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (error) {}
})();
`
