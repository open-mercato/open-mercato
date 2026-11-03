import { appendTrackingPixel, applyTracking, rewriteLinksForTracking } from '../rewrite'

const track = (target: string) => `https://shop.test/api/marketing_automation/track/click?t=TOKEN(${target})`

describe('rewriteLinksForTracking', () => {
  test('rewrites an absolute http link', () => {
    expect(rewriteLinksForTracking('<a href="https://shop.test/x">go</a>', track))
      .toBe('<a href="https://shop.test/api/marketing_automation/track/click?t=TOKEN(https://shop.test/x)">go</a>')
  })

  test('keeps the original quote style and the rest of the tag', () => {
    const out = rewriteLinksForTracking(`<a class="btn" href='http://x.test/a' target="_blank">go</a>`, track)
    expect(out).toContain(`href='https://shop.test/api/marketing_automation/track/click?t=TOKEN(http://x.test/a)'`)
    expect(out).toContain('class="btn"')
    expect(out).toContain('target="_blank"')
  })

  test('rewrites every link, not just the first', () => {
    const out = rewriteLinksForTracking('<a href="https://a.test/1">1</a><a href="https://b.test/2">2</a>', track)
    expect(out.match(/track\/click/g)).toHaveLength(2)
  })

  // Conservative by design: anything that is not a plain absolute http(s) href is left alone.
  test.each([
    ['a mailto', '<a href="mailto:shop@example.com">mail</a>'],
    ['a tel', '<a href="tel:+48123456789">call</a>'],
    ['an in-message anchor', '<a href="#top">top</a>'],
    ['a relative path', '<a href="/offers">offers</a>'],
    ['a protocol-relative url', '<a href="//cdn.test/x">x</a>'],
    ['a javascript url', '<a href="javascript:alert(1)">x</a>'],
    ['an unquoted href', '<a href=https://x.test/a>x</a>'],
  ])('leaves %s untouched', (_label, html) => {
    expect(rewriteLinksForTracking(html, track)).toBe(html)
  })

  test('a maker that declines leaves the link alone', () => {
    const html = '<a href="https://x.test/a">x</a>'
    expect(rewriteLinksForTracking(html, () => null)).toBe(html)
  })

  // The target arrives HTML-escaped from the attribute and must be signed in its real form, or the
  // recipient is redirected to a url with a literal `&amp;` in it.
  test('unescapes the target before handing it to the maker', () => {
    const seen: string[] = []
    rewriteLinksForTracking('<a href="https://x.test/a?b=1&amp;c=2">x</a>', (target) => {
      seen.push(target)
      return null
    })
    expect(seen).toEqual(['https://x.test/a?b=1&c=2'])
  })

  test('escapes the tracking url back into the attribute', () => {
    const out = rewriteLinksForTracking('<a href="https://x.test/a">x</a>', () => 'https://shop.test/t?a=1&b=2')
    expect(out).toContain('href="https://shop.test/t?a=1&amp;b=2"')
  })
})

describe('appendTrackingPixel', () => {
  test('inserts before the closing body tag', () => {
    const out = appendTrackingPixel('<html><body><p>hi</p></body></html>', 'https://shop.test/pixel')
    expect(out).toBe('<html><body><p>hi</p><img src="https://shop.test/pixel" width="1" height="1" alt="" style="display:none" /></body></html>')
  })

  test('appends when the body is a fragment, which a campaign body usually is', () => {
    expect(appendTrackingPixel('<p>hi</p>', 'https://shop.test/pixel')).toMatch(/^<p>hi<\/p><img /)
  })

  test('escapes the pixel url', () => {
    expect(appendTrackingPixel('<p>x</p>', 'https://shop.test/p?a=1&b=2')).toContain('src="https://shop.test/p?a=1&amp;b=2"')
  })
})

describe('applyTracking', () => {
  test('rewrites and embeds in one pass', () => {
    const out = applyTracking('<a href="https://x.test/a">x</a>', { makeClickUrl: track, pixelUrl: 'https://shop.test/pixel' })
    expect(out).toContain('track/click')
    expect(out).toContain('<img src="https://shop.test/pixel"')
  })

  test('embeds nothing when there is no pixel url', () => {
    const out = applyTracking('<a href="https://x.test/a">x</a>', { makeClickUrl: track, pixelUrl: null })
    expect(out).not.toContain('<img')
  })
})
