import { resolveListCountCap, DEFAULT_LIST_COUNT_CAP } from '../count-cap'

describe('resolveListCountCap', () => {
  const original = process.env.OM_LIST_COUNT_CAP
  afterEach(() => {
    if (original === undefined) delete process.env.OM_LIST_COUNT_CAP
    else process.env.OM_LIST_COUNT_CAP = original
  })

  test('unset: the default cap — the cap is on by default', () => {
    delete process.env.OM_LIST_COUNT_CAP
    expect(resolveListCountCap()).toBe(DEFAULT_LIST_COUNT_CAP)
  })

  test('blank: the default cap', () => {
    process.env.OM_LIST_COUNT_CAP = '  '
    expect(resolveListCountCap()).toBe(DEFAULT_LIST_COUNT_CAP)
  })

  test('0 disables capping', () => {
    process.env.OM_LIST_COUNT_CAP = '0'
    expect(resolveListCountCap()).toBeNull()
  })

  test('negative values disable capping like 0', () => {
    process.env.OM_LIST_COUNT_CAP = '-5'
    expect(resolveListCountCap()).toBeNull()
  })

  test('a positive integer is used as-is; floats floor', () => {
    process.env.OM_LIST_COUNT_CAP = '500'
    expect(resolveListCountCap()).toBe(500)
    process.env.OM_LIST_COUNT_CAP = '500.9'
    expect(resolveListCountCap()).toBe(500)
  })

  test('unparseable input falls back to the default — bad input must not silently disable the cap', () => {
    process.env.OM_LIST_COUNT_CAP = 'unbounded'
    expect(resolveListCountCap()).toBe(DEFAULT_LIST_COUNT_CAP)
  })
})
