import type { SearchConfig } from '@open-mercato/shared/lib/search/config'
import { buildSearchTokenRows } from '../lib/search-tokens'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
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
  maxFieldChars: 20_000,
  maxTokensPerField: 5_000,
  maxTokensPerRecord: 20_000,
}

function buildWords(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(' ')
}

describe('buildSearchTokenRows limits', () => {
  test('caps token rows across all fields in one record', () => {
    const rows = buildSearchTokenRows({
      entityType: 'messages:message',
      recordId: 'record-1',
      doc: { subject: buildWords('subject', 20), body: buildWords('body', 20) },
      config: { ...baseConfig, maxTokensPerRecord: 10 },
    })

    expect(rows).toHaveLength(10)
  })

  test('shares the per-field budget across array entries', () => {
    const rows = buildSearchTokenRows({
      entityType: 'messages:message',
      recordId: 'record-2',
      doc: { tags: [buildWords('alpha', 10), buildWords('beta', 10)] },
      config: { ...baseConfig, maxTokensPerField: 4 },
    })

    expect(rows).toHaveLength(4)
  })

  test('preserves tokens when the document stays within the limits', () => {
    const rows = buildSearchTokenRows({
      entityType: 'messages:message',
      recordId: 'record-3',
      doc: { subject: 'alpha beta gamma' },
      config: baseConfig,
    })

    expect(rows).toHaveLength(3)
  })
})
