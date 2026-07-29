import { decodeEntities } from '../entities'
import { extractTitle, htmlToText, normalizeWhitespace } from '../text'

describe('decodeEntities', () => {
  it('decodes named, decimal and hex references', () => {
    expect(decodeEntities('a&amp;b &#65; &#x42;')).toBe('a&b A B')
  })

  it('leaves unknown or unterminated references alone', () => {
    expect(decodeEntities('&notareal; &amp')).toBe('&notareal; &amp')
  })

  it('maps nbsp to a plain space', () => {
    expect(decodeEntities('a&nbsp;b')).toBe('a b')
  })

  it('rejects lone surrogates', () => {
    expect(decodeEntities('&#xD800;')).toBe('�')
  })
})

describe('htmlToText', () => {
  it('strips markup and keeps readable text', () => {
    expect(htmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world')
  })

  it('drops script and style content', () => {
    const html = '<style>.a{color:red}</style><script>alert(1)</script><p>Body</p>'
    expect(htmlToText(html)).toBe('Body')
  })

  it('does not leak the document title into body text', () => {
    expect(htmlToText('<html><head><title>Tab</title></head><body><p>Body</p></body></html>')).toBe('Body')
  })

  it('separates paragraphs with a blank line', () => {
    expect(htmlToText('<p>one</p><p>two</p>')).toBe('one\n\ntwo')
  })

  it('keeps list items on separate lines', () => {
    expect(htmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('a\n\nb')
  })

  it('collapses runs of whitespace', () => {
    expect(normalizeWhitespace('a   \t b\n\n\n\nc')).toBe('a b\n\nc')
  })
})

describe('extractTitle', () => {
  it('reads the document title', () => {
    expect(extractTitle('<html><head><title> Hello  World </title></head></html>')).toBe('Hello World')
  })

  it('returns null when there is no title', () => {
    expect(extractTitle('<html><body><p>x</p></body></html>')).toBeNull()
  })

  it('does not scan past the start of the body', () => {
    expect(extractTitle('<body><title>late</title></body>')).toBeNull()
  })
})
