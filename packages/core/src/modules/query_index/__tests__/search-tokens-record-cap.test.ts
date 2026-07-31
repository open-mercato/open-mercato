import { buildSearchTokenRows } from '../lib/search-tokens'
import type { SearchConfig } from '@open-mercato/shared/lib/search/config'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const baseConfig: SearchConfig = {
  enabled: true,
  minTokenLength: 3,
  enablePartials: false,
  hashAlgorithm: 'sha256',
  storeRawTokens: false,
  blocklistedFields: [],
  maxFieldChars: 20000,
  maxTokensPerField: 5000,
  maxTokensPerRecord: 20000,
}

// #4681: a pathological document must never contribute an unbounded number of rows.
describe('buildSearchTokenRows record cap', () => {
  const manyWords = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ')

  it('caps the total rows emitted for a single record across fields', () => {
    const config: SearchConfig = { ...baseConfig, maxTokensPerField: 1000, maxTokensPerRecord: 10 }
    const rows = buildSearchTokenRows({
      entityType: 'messages:message',
      recordId: 'rec-1',
      doc: { subject: manyWords(50), body: manyWords(50) },
      config,
    })
    expect(rows.length).toBe(10)
  })

  it('bounds an array-valued field to maxTokensPerField across all entries', () => {
    // Distinct tokens per entry: without a field-spanning budget each entry would
    // add up to maxTokensPerField (4×3=12); with it, the whole field caps at 4.
    const distinct = (prefix: string) => Array.from({ length: 10 }, (_, i) => `${prefix}word${i}`).join(' ')
    const config: SearchConfig = { ...baseConfig, maxTokensPerField: 4, maxTokensPerRecord: 1000 }
    const rows = buildSearchTokenRows({
      entityType: 'messages:message',
      recordId: 'rec-arr',
      doc: { tags: [distinct('a'), distinct('b'), distinct('c')] },
      config,
    })
    expect(rows.length).toBe(4)
  })

  it('does not cap a record that stays within the limit', () => {
    const config: SearchConfig = { ...baseConfig }
    const rows = buildSearchTokenRows({
      entityType: 'messages:message',
      recordId: 'rec-2',
      doc: { subject: 'alpha beta gamma' },
      config,
    })
    expect(rows.map((row) => row.token_hash)).toHaveLength(3)
  })
})
