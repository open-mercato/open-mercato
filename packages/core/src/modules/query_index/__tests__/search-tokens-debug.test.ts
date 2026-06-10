import { buildSearchTokenRows } from '../lib/search-tokens'
import type { SearchConfig } from '@open-mercato/shared/lib/search/config'

const config: SearchConfig = {
  enabled: true,
  minTokenLength: 3,
  enablePartials: true,
  hashAlgorithm: 'sha256',
  storeRawTokens: false,
  blocklistedFields: ['password', 'token', 'secret', 'hash'],
}

const collectDebugPayloads = (calls: unknown[][]): Record<string, unknown>[] => {
  return calls
    .filter((args) => typeof args[0] === 'string' && (args[0] as string).startsWith('[search-tokens]'))
    .map((args) => (args[1] ?? {}) as Record<string, unknown>)
}

const deepStringValues = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') {
    out.push(value)
  } else if (Array.isArray(value)) {
    for (const entry of value) deepStringValues(entry, out)
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) deepStringValues(entry, out)
  }
  return out
}

describe('buildSearchTokenRows debug logging redaction (issue #2709)', () => {
  const previousDebug = process.env.OM_SEARCH_DEBUG
  let debugSpy: jest.SpyInstance

  beforeEach(() => {
    process.env.OM_SEARCH_DEBUG = 'true'
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    debugSpy.mockRestore()
    if (previousDebug === undefined) delete process.env.OM_SEARCH_DEBUG
    else process.env.OM_SEARCH_DEBUG = previousDebug
  })

  it('does not log raw token text for generated tokens', () => {
    const secretWord = 'zxqvtopsecretname'
    buildSearchTokenRows({
      entityType: 'customers:customer_person_profile',
      recordId: 'rec-1',
      doc: { display_name: secretWord },
      config,
    })

    const payloads = collectDebugPayloads(debugSpy.mock.calls)
    expect(payloads.length).toBeGreaterThan(0)
    const loggedStrings = payloads.flatMap((payload) => deepStringValues(payload))
    expect(loggedStrings).not.toContain(secretWord)
    expect(loggedStrings.some((value) => value.includes(secretWord))).toBe(false)
  })

  it('does not log the deal title or raw deal tokens', () => {
    const dealTitle = 'qzwxsecretdealtitle'
    buildSearchTokenRows({
      entityType: 'customers:customer_deal',
      recordId: 'deal-1',
      doc: { title: dealTitle },
      config,
    })

    const payloads = collectDebugPayloads(debugSpy.mock.calls)
    const dealPayloads = payloads.filter((payload) =>
      JSON.stringify(payload).includes('"tokenCount"') || payload.entityType === 'customers:customer_deal')
    expect(dealPayloads.length).toBeGreaterThan(0)
    const loggedStrings = payloads.flatMap((payload) => deepStringValues(payload))
    expect(loggedStrings).not.toContain(dealTitle)
    expect(loggedStrings.some((value) => value.includes(dealTitle))).toBe(false)
  })

  it('still emits hashes so index shape stays debuggable', () => {
    buildSearchTokenRows({
      entityType: 'customers:customer_person_profile',
      recordId: 'rec-2',
      doc: { display_name: 'Jane Doe Example' },
      config,
    })

    const payloads = collectDebugPayloads(debugSpy.mock.calls)
    const tokenPayloads = payloads.filter((payload) => 'hash' in payload)
    expect(tokenPayloads.length).toBeGreaterThan(0)
    for (const payload of tokenPayloads) {
      expect(typeof payload.hash).toBe('string')
      expect(payload.hash).not.toBe('')
    }
  })
})
