import { parseRotationJson, parseRotationFieldValue } from '../rotationJson'

test('preserves exact numeric tokens through JSON serialization', () => {
  const source = '{"n":1.0000000000000000001,"integer":9007199254740993,"nested":[1e30,-0,1.00],"quote":"a\\\"b","slash":"a\\\\"}'
  expect(JSON.stringify(parseRotationJson(source))).toBe(source)
})
test('bounds structural nesting and breadth before JSON.parse allocates objects', () => {
  expect(() => parseRotationJson('['.repeat(65) + '0' + ']'.repeat(65))).toThrow('COVERAGE_UNSUPPORTED')
  expect(() => parseRotationJson('[' + '0,'.repeat(10001) + '0]')).toThrow('COVERAGE_UNSUPPORTED')
  expect(() => parseRotationJson(JSON.stringify('a'.repeat(1024 * 1024)))).toThrow('COVERAGE_UNSUPPORTED')
})

test('UTF-16 size shortcut retains the exact UTF-8 limit for short and long multibyte JSON', () => {
  const short = '"' + '\u0800'.repeat(Math.floor(1024 * 1024 / 3) - 2) + '"'
  expect(parseRotationJson(short)).toBe(JSON.parse(short))
  // These inputs exceed the conservative UTF-16 threshold, yet fit exactly
  // one MiB in UTF-8. They must use the byte bound, not a character rejection.
  for (const value of ['\u0800'.repeat(349524) + 'aa', '😀'.repeat(262143) + 'aa', 'a'.repeat(1024 * 1024 - 2)]) {
    const atLimit = '"' + value + '"'
    expect(Buffer.byteLength(atLimit)).toBe(1024 * 1024)
    expect(parseRotationJson(atLimit)).toBe(value)
    expect(() => parseRotationJson('"' + value + 'a"')).toThrow('COVERAGE_UNSUPPORTED')
  }
})


test.each(['{hello', '[Street] foo', '{"unterminated', 'hello', '00123'])('preserves non-JSON TEXT %s', value => {
  expect(parseRotationFieldValue(value)).toBe(value)
})
