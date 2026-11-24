import fs from 'node:fs'
import path from 'node:path'
import { renderMaintenancePage } from '../lib/page/render'
import { resetTemplateCacheForTests, validateTemplate } from '../lib/page/template'
import { sanitizeUrl } from '../lib/page/escape'
import { buildPageContentSecurityPolicy } from '../lib/page/bypass-form'
import { makeTempDir } from './helpers'

const t = (_key: string, fallback: string) => fallback

function render(overrides: Partial<Parameters<typeof renderMaintenancePage>[0]> = {}) {
  return renderMaintenancePage({
    locale: 'en', t, until: null, retryAfterSeconds: 300, timezone: 'UTC',
    logoUrl: null, supportUrl: null, templatePath: null, now: new Date(), ...overrides,
  })
}

afterEach(() => resetTemplateCacheForTests())

describe('maintenance page renderer', () => {
  it('renders a self-contained, script-free page', () => {
    const html = render()
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('role="main"')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('http-equiv="refresh" content="300"')
  })

  it('renders <script> in the message inert and newlines as paragraphs', () => {
    const html = render({ title: 'Upgrade <b>now</b>', message: 'Line one\n<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<p>Line one</p>')
    expect(html).toContain('Upgrade &lt;b&gt;now&lt;/b&gt;')
  })

  it('renders the expected end time with a machine-readable attribute', () => {
    const html = render({ until: '2026-11-14T02:00:00.000Z' })
    expect(html).toContain('<time datetime="2026-11-14T02:00:00.000Z">')
  })

  it('caps the refresh at 300 seconds', () => {
    expect(render({ retryAfterSeconds: 3600 })).toContain('content="300"')
  })

  it('drops javascript: support URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeUrl('//evil.example')).toBeNull()
    expect(sanitizeUrl('/help')).toBe('/help')
    expect(render({ supportUrl: 'javascript:alert(1)' })).not.toContain('javascript:')
    expect(render({ supportUrl: 'https://help.example/x' })).toContain('href="https://help.example/x"')
  })

  it('pins inline styles in the page CSP by hash', () => {
    const csp = buildPageContentSecurityPolicy(render())
    expect(csp).toMatch(/style-src 'sha256-[A-Za-z0-9+/=]+'/)
    expect(csp).toContain("script-src 'none'")
  })
})

describe('instance templates', () => {
  function writeTemplate(content: string): string {
    const file = path.join(makeTempDir(), 'page.html')
    fs.writeFileSync(file, content)
    return file
  }

  it('renders a valid template with escaped placeholders', () => {
    const file = writeTemplate('<html lang="{{lang}}"><h1>{{title}}</h1><p>{{message}}</p><a href="{{supportUrl}}">x</a></html>')
    const html = render({ templatePath: file, title: '<i>x</i>', supportUrl: 'javascript:alert(1)' })
    expect(html).toContain('<h1>&lt;i&gt;x&lt;/i&gt;</h1>')
    expect(html).toContain('href=""')
  })

  it('rejects scripts, handlers, javascript: URLs, style placeholders and missing placeholders', () => {
    expect(validateTemplate('<script></script>{{title}}{{message}}').ok).toBe(false)
    expect(validateTemplate('<p onclick="x">{{title}}{{message}}</p>').ok).toBe(false)
    expect(validateTemplate('<a href="javascript:void(0)">{{title}}{{message}}</a>').ok).toBe(false)
    expect(validateTemplate('<style>.a{color:{{title}}}</style>{{message}}').ok).toBe(false)
    expect(validateTemplate('<p>{{title}}</p>').ok).toBe(false)
    expect(validateTemplate('<p>{{title}}{{message}}{{bogus}}</p>').ok).toBe(false)
    expect(validateTemplate('<p>{{title}}</p><p>{{message}}</p>').ok).toBe(true)
  })

  it('falls back to the built-in page when the template is invalid', () => {
    const file = writeTemplate('<script>alert(1)</script>{{title}}{{message}}')
    const html = render({ templatePath: file })
    expect(html).toContain('role="main"')
    expect(html).not.toContain('alert(1)')
  })
})
