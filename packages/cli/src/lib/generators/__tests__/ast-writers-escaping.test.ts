/**
 * `stringLiteral` is the only place a JavaScript string value becomes source text in the
 * AST generator stack. It must escape the characters that are legal inside a JSON string
 * but hazardous inside an emitted source file, matching the escaping the string emitters
 * applied before they were retired — otherwise the migration would have silently dropped
 * that hardening from every generated file.
 */
import { stringLiteral, writeValue } from '../ast/writers'
import type { CodeBlockWriter } from 'ts-morph'

function render(value: unknown): string {
  const chunks: string[] = []
  const writer = { write: (text: string) => { chunks.push(text) } } as unknown as CodeBlockWriter
  writeValue(writer, value as never)
  return chunks.join('')
}

describe('stringLiteral', () => {
  it('escapes angle brackets so an emitted value cannot close a surrounding script context', () => {
    expect(stringLiteral('a</script>b')).toBe('"a\\u003c/script\\u003eb"')
  })

  it('escapes the line and paragraph separators older parsers reject inside a string literal', () => {
    expect(stringLiteral('a b c')).toBe('"a\\u2028b\\u2029c"')
  })

  it('leaves an ordinary string as plain JSON', () => {
    expect(stringLiteral('catalog:commands:products')).toBe('"catalog:commands:products"')
  })

  it('still escapes what JSON escapes', () => {
    expect(stringLiteral('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"')
  })

  it('denotes the same runtime string after escaping', () => {
    const original = 'a</script>b c'
    expect(JSON.parse(stringLiteral(original))).toBe(original)
  })
})

describe('writeValue', () => {
  it('routes string values through the escaping helper', () => {
    expect(render('a<b>c')).toBe('"a\\u003cb\\u003ec"')
  })

  it('leaves non-string primitives alone', () => {
    expect(render(42)).toBe('42')
    expect(render(true)).toBe('true')
    expect(render(null)).toBe('null')
    expect(render(undefined)).toBe('undefined')
  })
})
