export const THEME_STORAGE_KEY = 'om-theme'

/**
 * Inline source for the root layout's theme initializer.
 *
 * It MUST be rendered as a plain, non-deferred `<script>` element so the browser
 * executes it while parsing the document, before the first paint. Deferring it —
 * for example through `next/script` with `strategy="beforeInteractive"`, which in
 * the App Router only queues the code onto `self.__next_s` for the client runtime
 * to replay once hydration starts — makes the page paint in light theme first and
 * flash to dark afterwards.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var theme = stored === 'dark' ? 'dark'
      : stored === 'light' ? 'light'
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch (error) {}
})();
`
