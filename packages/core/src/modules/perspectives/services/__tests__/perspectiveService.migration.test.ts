/**
 * Defensive migration for legacy filterValues-shaped perspective records
 * (SPEC-048 / CRM filter Figma redesign Phase 3, Task 3.5).
 *
 * Production data is not known to use the legacy shape — `PerspectiveSettings.filters`
 * is `z.record(z.string(), z.unknown()).optional()` and existing CRM pages write only
 * advanced-filter URL params (tree shape). The helper is a safety net for old
 * imported saved-view JSON. It MUST:
 *   - pass through tree-shaped state unchanged (already a v2 advanced-filter tree)
 *   - drop legacy `FilterValues` records (we have no reliable mapping back to operators)
 *   - pass through undefined / null filters unchanged
 */
import { describe, it, expect, jest } from '@jest/globals'
import { maybeMigrateLegacyFilterValues } from '../perspectiveService'

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
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
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
