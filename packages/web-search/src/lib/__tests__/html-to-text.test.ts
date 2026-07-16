import { extractTitle, htmlToText } from '../html-to-text'

describe('extractTitle', () => {
  it('returns the decoded, trimmed title', () => {
    expect(extractTitle('<html><head><title>  Acme &amp; Co  </title></head></html>')).toBe('Acme & Co')
  })

  it('returns undefined when there is no title', () => {
    expect(extractTitle('<html><body>no title</body></html>')).toBeUndefined()
  })
})

describe('htmlToText', () => {
  it('strips scripts, styles and comments', () => {
    const html =
      '<html><head><style>.x{color:red}</style></head><body><script>evil()</script><p>Hello</p><!-- hi --></body></html>'
    const text = htmlToText(html)
    expect(text).toContain('Hello')
    expect(text).not.toContain('evil')
    expect(text).not.toContain('color:red')
  })

  it('decodes entities and collapses whitespace', () => {
    expect(htmlToText('<p>a&nbsp;&amp;&nbsp;b   c</p>')).toBe('a & b c')
  })

  it('inserts line breaks between block elements', () => {
    expect(htmlToText('<p>one</p><p>two</p>')).toBe('one\ntwo')
  })
})
