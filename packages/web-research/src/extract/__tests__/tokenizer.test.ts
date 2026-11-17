import { tokenizeHtml, type HtmlToken } from '../tokenizer'

const collect = (html: string): HtmlToken[] => [...tokenizeHtml(html)]

describe('tokenizeHtml', () => {
  it('emits open, text and close tokens in document order', () => {
    expect(collect('<p>hi</p>')).toEqual([
      { kind: 'open', name: 'p', attributes: new Map(), selfClosing: false },
      { kind: 'text', value: 'hi' },
      { kind: 'close', name: 'p' },
    ])
  })

  it('lowercases tag and attribute names', () => {
    const [token] = collect('<DIV CLASS="Body">')
    expect(token).toMatchObject({ kind: 'open', name: 'div' })
    if (token.kind !== 'open') throw new Error('expected an open token')
    expect(token.attributes.get('class')).toBe('Body')
  })

  it('parses single-quoted, double-quoted and bare attribute values', () => {
    const [token] = collect(`<a href='/x' title="y" data-n=3>`)
    if (token.kind !== 'open') throw new Error('expected an open token')
    expect(token.attributes.get('href')).toBe('/x')
    expect(token.attributes.get('title')).toBe('y')
    expect(token.attributes.get('data-n')).toBe('3')
  })

  it('does not truncate a tag on a > inside a quoted attribute value', () => {
    const [token] = collect('<a title="a > b" href="/ok">text</a>')
    if (token.kind !== 'open') throw new Error('expected an open token')
    expect(token.attributes.get('title')).toBe('a > b')
    expect(token.attributes.get('href')).toBe('/ok')
  })

  it('decodes entities in attribute values and text', () => {
    const tokens = collect('<a title="a&amp;b">x&lt;y</a>')
    const [open, text] = tokens
    if (open.kind !== 'open') throw new Error('expected an open token')
    expect(open.attributes.get('title')).toBe('a&b')
    expect(text).toEqual({ kind: 'text', value: 'x<y' })
  })

  it('skips comments and doctypes', () => {
    expect(collect('<!DOCTYPE html><!-- note --><p>a</p>').map((token) => token.kind)).toEqual([
      'open',
      'text',
      'close',
    ])
  })

  it('drops raw text inside script and style', () => {
    const tokens = collect('<script>var a = "<p>no</p>";</script><p>yes</p>')
    const text = tokens.filter((token) => token.kind === 'text').map((token) => token.value)
    expect(text).toEqual(['yes'])
  })

  it('synthesizes a close token for void elements', () => {
    expect(collect('<br>').map((token) => token.kind)).toEqual(['open', 'close'])
  })

  it('treats a stray angle bracket as text', () => {
    expect(collect('5 < 7')).toEqual([
      { kind: 'text', value: '5 ' },
      { kind: 'text', value: '<' },
      { kind: 'text', value: ' 7' },
    ])
  })

  it('survives unterminated markup without hanging', () => {
    expect(() => collect('<div class="x')).not.toThrow()
    expect(() => collect('<!-- never closed')).not.toThrow()
    expect(() => collect('<script>forever')).not.toThrow()
  })

  it('runs in linear time on adversarial nesting', () => {
    // A regex-based extractor with lazy quantifiers stalls on this shape; the
    // linear scan must not.
    const hostile = `${'<div class="a">'.repeat(20_000)}text`
    const started = Date.now()
    const tokens = collect(hostile)
    expect(tokens.length).toBeGreaterThan(20_000)
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})
