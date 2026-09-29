import { classifyPage } from '../classify'
import { extractMainContent } from '../content'

const paragraph = (marker: string): string =>
  `<p>${marker} ${'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod. '.repeat(4)}</p>`

describe('extractMainContent', () => {
  it('prefers the article over navigation chrome', () => {
    const html = `
      <body>
        <nav class="site-nav"><a href="/a">Home</a><a href="/b">Products</a><a href="/c">Pricing</a></nav>
        <div class="sidebar"><a href="/x">Related one</a><a href="/y">Related two</a></div>
        <article class="post-body">${paragraph('ARTICLE')}${paragraph('ARTICLE')}</article>
        <footer class="site-footer"><a href="/tos">Terms</a></footer>
      </body>`
    const text = extractMainContent(html)
    expect(text).toContain('ARTICLE')
    expect(text).not.toContain('Terms')
    expect(text).not.toContain('Pricing')
  })

  it('penalizes a link-dense block against a prose block of similar length', () => {
    const links = `<div class="menu">${'<a href="/l">navigation link text here</a>'.repeat(30)}</div>`
    const prose = `<div class="entry-content">${paragraph('PROSE')}</div>`
    const text = extractMainContent(`<body>${links}${prose}</body>`)
    expect(text).toContain('PROSE')
  })

  it('falls back to the whole document when nothing scores well', () => {
    expect(extractMainContent('<body><p>tiny</p></body>')).toBe('tiny')
  })

  it('tolerates unbalanced markup', () => {
    const html = `<body><div class="content"><article>${paragraph('X')}</div></body>`
    expect(() => extractMainContent(html)).not.toThrow()
    expect(extractMainContent(html)).toContain('X')
  })
})

describe('classifyPage', () => {
  const base = { status: 200, contentType: 'text/html' }

  it('accepts a page with real text', () => {
    const text = 'a'.repeat(500)
    expect(classifyPage({ ...base, html: `<p>${text}</p>`, text }).verdict).toBe('ok')
  })

  it.each([403, 429, 503])('treats HTTP %s as blocked', (status) => {
    expect(classifyPage({ ...base, status, html: '<html></html>', text: '' }).verdict).toBe('blocked')
  })

  it('detects an anti-bot interstitial', () => {
    const html = '<html><body><h1>Just a moment...</h1><div id="cf_chl_opt"></div></body></html>'
    expect(classifyPage({ ...base, html, text: 'Just a moment...' }).verdict).toBe('blocked')
  })

  // Observed against a real LinkedIn company page: 12,987 chars of usable text,
  // but the word "captcha" appears in a bundled script. Flagging that as blocked
  // triggers a browser render for a page that already worked.
  it('does not call a content-bearing page blocked just because its markup mentions a challenge', () => {
    const text = 'Stripe. Technology, Information and Internet. '.repeat(40)
    const html = `<html><body><script>var x="captcha";</script><article><p>${text}</p></article></body></html>`
    expect(classifyPage({ ...base, html, text }).verdict).toBe('ok')
  })

  it('detects a client-side render shell', () => {
    const html = `<html><body><div id="root"></div>${'<script>x</script>'.repeat(400)}</body></html>`
    expect(classifyPage({ ...base, html, text: '' }).verdict).toBe('js-shell')
  })

  it('detects a JavaScript-required notice', () => {
    const html = '<html><body><noscript>You need to enable JavaScript to run this app.</noscript></body></html>'
    const result = classifyPage({ ...base, html, text: '' })
    expect(result.verdict).toBe('js-shell')
    expect(result.reason).toContain('JavaScript')
  })

  it('reports an empty body as empty rather than blocked', () => {
    expect(classifyPage({ ...base, html: '', text: '' }).verdict).toBe('empty')
  })
})
