/**
 * Deprecated `maybeMigrateLegacyFilterValues` helper, kept as a compatibility export.
 *
 * The perspectives read path no longer calls it (see perspectiveService.filters.test.ts),
 * but its behaviour is unchanged for callers that still import it. It MUST:
 *   - pass through tree-shaped state unchanged (already a v2 advanced-filter tree)
 *   - drop legacy `FilterValues` records
 *   - pass through undefined / null filters unchanged
 */
import { describe, it, expect, jest } from '@jest/globals'
import { maybeMigrateLegacyFilterValues } from '../perspectiveService'

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

const mockLogger = jest.requireMock('@open-mercato/shared/lib/logger').createLogger('test') as {
  debug: jest.Mock
  info: jest.Mock
  warn: jest.Mock
  error: jest.Mock
}


describe('maybeMigrateLegacyFilterValues', () => {
  it('passes through tree-shaped filters with v:2 unchanged', () => {
    const s: any = {
      filters: { v: 2, root: { id: 'r', type: 'group', combinator: 'and', children: [] } },
    }
    expect(maybeMigrateLegacyFilterValues(s)).toEqual(s)
  })

  it('passes through tree-shaped filters with root key unchanged', () => {
    const s: any = {
      filters: { root: { id: 'r', type: 'group', combinator: 'and', children: [] } },
    }
    expect(maybeMigrateLegacyFilterValues(s)).toEqual(s)
  })

  it('drops legacy filterValues-shaped records and emits a warning', () => {
    mockLogger.warn.mockClear()
    const warnSpy = mockLogger.warn
    const s: any = {
      filters: { status: 'active', source: 'web' },
      columnVisibility: { name: true },
    }
    const out = maybeMigrateLegacyFilterValues(s)
    expect(out.filters).toBeUndefined()
    expect(out.columnVisibility).toEqual({ name: true })
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('passes through undefined filters', () => {
    const s: any = {}
    expect(maybeMigrateLegacyFilterValues(s)).toEqual(s)
  })

  it('passes through null filters', () => {
    const s: any = { filters: null }
    expect(maybeMigrateLegacyFilterValues(s)).toEqual(s)
  })
})
