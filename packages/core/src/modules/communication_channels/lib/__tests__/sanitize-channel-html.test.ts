import { sanitizeChannelHtml } from '../sanitize-channel-html'

describe('sanitizeChannelHtml', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeChannelHtml('')).toBe('')
  })

  it('strips <script> tags entirely', () => {
    const out = sanitizeChannelHtml('<p>Hello</p><script>alert(1)</script><p>World</p>')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/alert/)
    expect(out).toMatch(/Hello/)
    expect(out).toMatch(/World/)
  })

  it('strips event-handler attributes (onerror, onclick, etc.)', () => {
    const out = sanitizeChannelHtml('<img src="x.png" onerror="alert(1)" onclick="alert(2)" />')
    expect(out).not.toMatch(/onerror/i)
    expect(out).not.toMatch(/onclick/i)
    expect(out).not.toMatch(/alert/)
    expect(out).toMatch(/<img/i)
    expect(out).not.toMatch(/\ssrc=/)
  })

  it('strips javascript: URLs from href', () => {
    const out = sanitizeChannelHtml('<a href="javascript:alert(1)">link</a>')
    expect(out).not.toMatch(/javascript:/i)
    expect(out).toMatch(/>link</)
  })

  it('strips data:text/html URLs from href', () => {
    const out = sanitizeChannelHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>')
    expect(out).not.toMatch(/data:text\/html/i)
    expect(out).not.toMatch(/<script/i)
  })

  it('preserves data:image/png base64 URLs in <img src>', () => {
    const tinyPng = 'data:image/png;base64,iVBORw0KGgo='
    const out = sanitizeChannelHtml(`<img src="${tinyPng}" alt="x" />`)
    expect(out).toMatch(/data:image\/png;base64,iVBORw0KGgo=/)
    expect(out).toMatch(/alt="x"/)
  })

  it('preserves data:image/jpeg base64 URLs in <img src>', () => {
    const tinyJpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    const out = sanitizeChannelHtml(`<img src="${tinyJpg}" />`)
    expect(out).toMatch(/data:image\/jpeg;base64,/)
  })

  it.each([
    ['https://sender.example/pixel.gif?open=1&reader=2', 'https://sender.example/pixel.gif?open=1&amp;reader=2'],
    ['http://sender.example/pixel.gif', 'http://sender.example/pixel.gif'],
    ['HTTPS://sender.example/pixel.gif', 'https://sender.example/pixel.gif'],
    ['//sender.example/pixel.gif', 'https://sender.example/pixel.gif'],
  ])('defers remote image source %s without an active src', (source, deferredSource) => {
    const out = sanitizeChannelHtml(`<img src="${source}" alt="Sender image" srcset="https://other.example/pixel.gif 2x" />`)
    expect(out).toContain(`data-channel-remote-src="${deferredSource}"`)
    expect(out).not.toMatch(/\ssrc=/)
    expect(out).not.toContain('srcset=')
    expect(out).toContain('alt="Sender image"')
  })

  it.each(['pixel.gif', '/pixel.gif', 'cid:attachment', 'javascript:alert(1)', 'file:///pixel.gif'])('blocks uncontrolled image source %s', (source) => {
    const out = sanitizeChannelHtml(`<img src="${source}" />`)
    expect(out).not.toMatch(/\ssrc=/)
    expect(out).not.toContain('data-channel-remote-src=')
  })

  it('discards sender-supplied deferred sources', () => {
    const out = sanitizeChannelHtml('<img data-channel-remote-src="https://forged.example/pixel.gif" />')
    expect(out).not.toContain('forged.example')
  })

  it('derives the deferred source only from the validated image source', () => {
    const out = sanitizeChannelHtml('<img src="https://sender.example/pixel.gif" data-channel-remote-src="javascript:alert(1)" />')
    expect(out).toContain('data-channel-remote-src="https://sender.example/pixel.gif"')
    expect(out).not.toContain('javascript:')
  })

  it.each(['data:image/svg+xml;base64,PHN2Zz4=', 'DATA:text/html;base64,PHNjcmlwdD4='])('strips unsafe embedded image type %s', (source) => {
    expect(sanitizeChannelHtml(`<img src="${source}" />`)).not.toContain('<img')
  })

  it('preserves <a> with safe href (https, mailto, tel)', () => {
    const httpsOut = sanitizeChannelHtml('<a href="https://example.com">x</a>')
    expect(httpsOut).toMatch(/href="https:\/\/example\.com"/)

    const mailtoOut = sanitizeChannelHtml('<a href="mailto:foo@bar.com">x</a>')
    expect(mailtoOut).toMatch(/href="mailto:foo@bar\.com"/)

    const telOut = sanitizeChannelHtml('<a href="tel:+14155551234">x</a>')
    expect(telOut).toMatch(/href="tel:\+14155551234"/)
  })

  it('preserves <table> structure for email layouts', () => {
    const html = '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'
    const out = sanitizeChannelHtml(html)
    expect(out).toMatch(/<table/i)
    expect(out).toMatch(/<thead/i)
    expect(out).toMatch(/<tbody/i)
    expect(out).toMatch(/<th[^>]*>A<\/th>/)
    expect(out).toMatch(/<td[^>]*>1<\/td>/)
  })

  it('removes <iframe> tags', () => {
    const out = sanitizeChannelHtml('<p>hi</p><iframe src="https://evil.com"></iframe>')
    expect(out).not.toMatch(/<iframe/i)
    expect(out).toMatch(/hi/)
  })

  it('removes <form>, <input>, <button> tags (avoid injecting forms into the inbox)', () => {
    const out = sanitizeChannelHtml('<form><input type="text"/><button>x</button></form>')
    expect(out).not.toMatch(/<form/i)
    expect(out).not.toMatch(/<input/i)
    expect(out).not.toMatch(/<button/i)
  })

  it('preserves <strong>, <em>, <a> for basic typography', () => {
    const out = sanitizeChannelHtml('<p><strong>bold</strong> and <em>italic</em></p>')
    expect(out).toMatch(/<strong>bold<\/strong>/)
    expect(out).toMatch(/<em>italic<\/em>/)
  })

  it('keeps safe color/background-color style values', () => {
    const hex = sanitizeChannelHtml('<p style="color:#ff0000;background-color:#0a0">hi</p>')
    expect(hex).toMatch(/color:#ff0000/)
    expect(hex).toMatch(/background-color:#0a0/)

    const rgb = sanitizeChannelHtml('<p style="color:rgb(10, 20, 30)">hi</p>')
    expect(rgb).toMatch(/color:rgb\(10, 20, 30\)/)

    const named = sanitizeChannelHtml('<span style="color:red">hi</span>')
    expect(named).toMatch(/color:red/)
  })

  it('strips CSS url() beacons from color/background-color', () => {
    const out = sanitizeChannelHtml(
      '<p style="background-color:url(\'https://evil.com/pixel.gif\')">hi</p>',
    )
    expect(out).not.toMatch(/url\(/i)
    expect(out).not.toMatch(/evil\.com/i)
    expect(out).toMatch(/hi/)
  })

  it('strips legacy CSS expression() from color/background-color', () => {
    const out = sanitizeChannelHtml('<p style="color:expression(alert(1))">hi</p>')
    expect(out).not.toMatch(/expression\(/i)
    expect(out).not.toMatch(/alert/)
    expect(out).toMatch(/hi/)
  })

  it('keeps display:none so the hidden thread-token footer stays hidden', () => {
    const out = sanitizeChannelHtml('<span style="display:none">[OM:om_token]</span>')
    expect(out).toMatch(/display:none/)
    expect(out).toMatch(/\[OM:om_token\]/)
  })

  it('strips display values other than none', () => {
    const block = sanitizeChannelHtml('<span style="display:block">x</span>')
    expect(block).not.toMatch(/display:block/)
    const flex = sanitizeChannelHtml('<span style="display:flex">x</span>')
    expect(flex).not.toMatch(/display:flex/)
  })
})
