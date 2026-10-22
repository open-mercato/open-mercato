import { z } from 'zod'
import { validateConfig } from '../validateConfig'

const schema = z.object({ size: z.number().int(), label: z.string().optional() }).strict()
type Settings = z.infer<typeof schema>

describe('validateConfig', () => {
  it('returns the parsed configuration', () => {
    expect(validateConfig({ size: 2 }, schema, new WeakMap<object, Settings>(), 'settings')).toEqual({ size: 2 })
  })

  it('throws an internal error naming the configuration and every failing field', () => {
    const run = () => validateConfig({ size: 1.5, extra: true }, schema, new WeakMap<object, Settings>(), 'settings')
    expect(run).toThrow('[internal] Invalid settings: ')
    expect(run).toThrow('size: ')
    expect(run).toThrow('(root): ')
  })

  it('validates one configuration object once and reuses the result', () => {
    const cache = new WeakMap<object, Settings>()
    const raw = { size: 3 }
    const first = validateConfig(raw, schema, cache, 'settings')
    raw.size = 1.5
    expect(validateConfig(raw, schema, cache, 'settings')).toBe(first)
  })
})
