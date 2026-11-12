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


test.each(['{hello', '[Street] foo', '{"unterminated', 'hello', '00123'])('preserves non-JSON TEXT %s', value => {
  expect(parseRotationFieldValue(value)).toBe(value)
})
