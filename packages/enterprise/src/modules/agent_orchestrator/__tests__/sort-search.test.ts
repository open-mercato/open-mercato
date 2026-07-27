/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import {
  PROCESS_HEADER_SORT_FIELDS,
  TRACES_DEFAULT_SORT,
  TRACES_HEADER_SORT_FIELDS,
  serverSortToSorting,
  sortingToServerSort,
} from '../components/serverSort'
import { normalizeRunIdPrefix, runIdPrefixRange, runIdPrefixSchema, runListQuerySchema } from '../data/validators'

// Consistency-pass Phase 3 (spec 2026-07-12-ux-consistency-pass Areas 3+6):
// header sorting on the two server-paginated tables must translate to the
// routes' whitelisted sort params (never a page-local reorder), and the two
// search gaps (run-id prefix on Traces, `q` on Processes) are closed.
describe('agent_orchestrator sort + search (consistency pass Phase 3)', () => {
  const moduleRoot = path.resolve(__dirname, '..')
  const read = (rel: string) => fs.readFileSync(path.join(moduleRoot, rel), 'utf8')
  const locales = ['en', 'es', 'de', 'pl'] as const
  const localeData = Object.fromEntries(
    locales.map((locale) => [locale, JSON.parse(read(`i18n/${locale}.json`)) as Record<string, string>]),
  )

  describe('run-id prefix search', () => {
    it('normalizes case and dashes, enforcing 4–32 hex chars', () => {
      expect(normalizeRunIdPrefix('9F3C')).toBe('9f3c')
      expect(normalizeRunIdPrefix('9f3c2e1a-4b')).toBe('9f3c2e1a4b')
      expect(normalizeRunIdPrefix('abc')).toBeNull()
      expect(normalizeRunIdPrefix('not-hex-zz')).toBeNull()
      expect(normalizeRunIdPrefix('a'.repeat(33))).toBeNull()
    })

    it('builds inclusive uuid bounds equivalent to prefix semantics', () => {
      const range = runIdPrefixRange('9f3c')
      expect(range).toEqual({
        from: '9f3c0000-0000-0000-0000-000000000000',
        to: '9f3cffff-ffff-ffff-ffff-ffffffffffff',
      })
    })

    it('handles prefixes that cross dash positions and full-length ids', () => {
      const crossing = runIdPrefixRange('9f3c2e1a4b')
      expect(crossing?.from).toBe('9f3c2e1a-4b00-0000-0000-000000000000')
      expect(crossing?.to).toBe('9f3c2e1a-4bff-ffff-ffff-ffffffffffff')
      const full = runIdPrefixRange('9f3c2e1a-4b7d-4c21-9d10-0123456789ab')
      expect(full?.from).toBe('9f3c2e1a-4b7d-4c21-9d10-0123456789ab')
      expect(full?.to).toBe('9f3c2e1a-4b7d-4c21-9d10-0123456789ab')
    })

    it('is accepted by the runs list query schema (and bad prefixes are not)', () => {
      expect(runListQuerySchema.safeParse({ idPrefix: '9f3c2e1a-4b' }).success).toBe(true)
      expect(runIdPrefixSchema.safeParse('zz3c').success).toBe(false)
      expect(runIdPrefixSchema.safeParse('9f').success).toBe(false)
    })

    it('the runs route translates idPrefix into the uuid range filter', () => {
      const source = read('api/runs/route.ts')
      expect(source).toContain('runIdPrefixRange(query.idPrefix)')
      expect(source).toContain('$gte: range.from')
      expect(source).toContain('$lte: range.to')
    })
  })

  describe('header sort ↔ server params', () => {
    it('maps a header click to the whitelisted server sort', () => {
      expect(sortingToServerSort([{ id: 'latency', desc: true }], TRACES_HEADER_SORT_FIELDS)).toEqual({
        field: 'latencyMs',
        dir: 'desc',
      })
      expect(sortingToServerSort([{ id: 'openedAt', desc: false }], PROCESS_HEADER_SORT_FIELDS)).toEqual({
        field: 'openedAt',
        dir: 'asc',
      })
    })

    it('returns null for columns without a server key (never a lying sort)', () => {
      expect(sortingToServerSort([{ id: 'eval', desc: true }], TRACES_HEADER_SORT_FIELDS)).toBeNull()
      expect(sortingToServerSort([{ id: 'subjectLabel', desc: false }], PROCESS_HEADER_SORT_FIELDS)).toBeNull()
      expect(sortingToServerSort([], TRACES_HEADER_SORT_FIELDS)).toBeNull()
    })

    it('round-trips server sort back into controlled table state', () => {
      expect(serverSortToSorting(TRACES_DEFAULT_SORT, TRACES_HEADER_SORT_FIELDS)).toEqual([
        { id: 'when', desc: true },
      ])
      expect(serverSortToSorting({ field: 'cost', dir: 'asc' }, PROCESS_HEADER_SORT_FIELDS)).toEqual([
        { id: 'costMinor', desc: false },
      ])
      expect(serverSortToSorting(null, PROCESS_HEADER_SORT_FIELDS)).toEqual([])
      expect(serverSortToSorting({ field: 'notMapped', dir: 'asc' }, TRACES_HEADER_SORT_FIELDS)).toEqual([])
    })

    it('every mapped field is whitelisted in its route sortFieldMap', () => {
      const runsRoute = read('api/runs/route.ts')
      for (const field of Object.values(TRACES_HEADER_SORT_FIELDS)) {
        expect(runsRoute).toContain(`${field}:`)
      }
      const processesRoute = read('api/processes/route.ts')
      for (const field of Object.values(PROCESS_HEADER_SORT_FIELDS)) {
        expect(processesRoute).toContain(`${field}:`)
      }
    })
  })

  describe('page wiring invariants', () => {
    it('traces table sorts server-side (manualSorting + one sort state for header and toolbar)', () => {
      const source = read('backend/traces/page.tsx')
      expect(source).toContain('manualSorting')
      expect(source).toContain('sorting={tableSorting}')
      expect(source).toContain('onSortingChange={handleSortingChange}')
      expect(source).toContain('sortField: sort.field')
      expect(source).toContain('sortDir: sort.dir')
      // The eval badge column must not advertise a server ordering it lacks.
      expect(source).toMatch(/id: 'eval',[\s\S]{0,400}enableSorting: false/)
      // Debounced full-history id search reaches the server.
      expect(source).toContain('scoped.idPrefix = idPrefix')
      expect(source).toContain('normalizeRunIdPrefix(search)')
    })

    it('processes table sorts server-side and searches via q, debounced', () => {
      const source = read('backend/processes/page.tsx')
      expect(source).toContain('manualSorting')
      expect(source).toContain('sortingToServerSort(next, PROCESS_HEADER_SORT_FIELDS)')
      expect(source).toContain("params.set('q', q)")
      expect(source).toContain('setTimeout(() => setQ(search.trim()), 300)')
      for (const column of ['subjectLabel', 'subjectType', 'currentStage']) {
        expect(source).toMatch(new RegExp(`accessorKey: '${column}',[\\s\\S]{0,400}enableSorting: false`))
      }
      expect(source).toContain('agent_orchestrator.process.list.searchHint')
      expect(source).toContain('agent_orchestrator.process.list.searchEmpty')
    })

    it.each(locales)('locale %s carries the new search/sort keys', (locale) => {
      const data = localeData[locale]
      for (const key of [
        'agent_orchestrator.traces.sort.custom',
        'agent_orchestrator.process.list.searchPlaceholder',
        'agent_orchestrator.process.list.searchHint',
        'agent_orchestrator.process.list.searchEmpty',
      ]) {
        expect(data[key]).toBeTruthy()
      }
      // The traces placeholder now advertises run-id search.
      expect(data['agent_orchestrator.traces.searchPlaceholder']).toBeTruthy()
    })
  })
})
