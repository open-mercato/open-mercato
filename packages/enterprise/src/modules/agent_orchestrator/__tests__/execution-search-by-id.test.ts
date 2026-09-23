/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import { normalizeFilters } from '@open-mercato/shared/lib/query/join-utils'
import { buildExecutionSearchBranches } from '../lib/processes/executionSearch'
import { uuidPrefixRange } from '../data/validators'
import { mapProcessListRow } from '../components/processTypes'

/**
 * Issue #5989 — the Processes list search could only match `subject_label`, but
 * a process with no subject renders the first eight hex characters of its
 * workflow instance id instead. Typing the one identifier on screen returned
 * zero results.
 */
describe('Processes list search (#5989)', () => {
  const moduleRoot = path.resolve(__dirname, '..')
  const read = (rel: string) => fs.readFileSync(path.join(moduleRoot, rel), 'utf8')
  const locales = ['en', 'pl', 'de', 'es', 'ko'] as const

  describe('buildExecutionSearchBranches', () => {
    it('matches the SHORT id the list shows, case-insensitively', () => {
      const branches = buildExecutionSearchBranches('05CF8116')
      expect(branches).toEqual([
        { subject_label: { $ilike: '%05CF8116%' } },
        {
          workflow_instance_id: {
            $gte: '05cf8116-0000-0000-0000-000000000000',
            $lte: '05cf8116-ffff-ffff-ffff-ffffffffffff',
          },
        },
      ])
      expect(buildExecutionSearchBranches('05cf8116')?.[1]).toEqual(branches?.[1])
    })

    it('narrows to a single row for a pasted full id, dashes and all', () => {
      const full = '05cf8116-4b7d-4c21-9d10-0123456789ab'
      const range = uuidPrefixRange(full)
      expect(range).toEqual({ from: full, to: full })
      expect(buildExecutionSearchBranches(full.toUpperCase())?.[1]).toEqual({
        workflow_instance_id: { $gte: full, $lte: full },
      })
    })

    it('keeps the subject-reference branch, and only that, for non-id terms', () => {
      expect(buildExecutionSearchBranches('CASE-2026-04417')).toEqual([
        { subject_label: { $ilike: '%CASE-2026-04417%' } },
      ])
      // Below the 4-hex-char floor the range would sweep a sixteenth of the
      // table for no signal, so the id branch stays out.
      expect(buildExecutionSearchBranches('05c')).toEqual([
        { subject_label: { $ilike: '%05c%' } },
      ])
    })

    it('escapes like wildcards so a pasted `%` cannot widen the match', () => {
      expect(buildExecutionSearchBranches('100%_case')).toEqual([
        { subject_label: { $ilike: '%100\\%\\_case%' } },
      ])
    })

    it('returns null for an empty or whitespace-only term', () => {
      expect(buildExecutionSearchBranches('')).toBeNull()
      expect(buildExecutionSearchBranches('   ')).toBeNull()
    })
  })

  describe('the where clause the query engine compiles', () => {
    const branches = buildExecutionSearchBranches('05CF8116')!

    it('is a real OR across the two columns', () => {
      const normalized = normalizeFilters({ $or: branches })
      const groups = new Set(normalized.map((filter) => filter.orGroup))
      expect(groups.size).toBe(2)
      expect(normalized.filter((filter) => filter.field === 'subject_label')).toHaveLength(1)
      expect(normalized.filter((filter) => filter.field === 'workflow_instance_id')).toHaveLength(2)
    })

    it('still ANDs a facet scope over every branch (the tab counts stay honest)', () => {
      const normalized = normalizeFilters({ $or: branches, subject_fraud: { $eq: true } })
      const fraud = normalized.filter((filter) => filter.field === 'subject_fraud')
      expect(fraud).toHaveLength(1)
      // Lifted out of the disjunction => ANDed with it, never OR'd into a branch.
      expect(fraud[0].orGroup).toBeUndefined()
    })
  })

  describe('route + page wiring', () => {
    const route = read('api/executions/route.ts')

    it('the executions route ORs the branches instead of matching subject_label alone', () => {
      expect(route).toContain('buildExecutionSearchBranches(query.q)')
      expect(route).toContain('filters.$or = searchBranches')
      expect(route).not.toContain('filters.subject_label =')
    })

    it('keeps the row-level tenant/organization scope the factory applies', () => {
      expect(route).toContain("orgField: 'organizationId'")
      expect(route).toContain("tenantField: 'tenantId'")
      expect(route).not.toContain('omitAutomaticTenantOrgScope')
    })

    it('the list still renders the short id when there is no subject reference', () => {
      const instanceId = '05cf8116-4b7d-4c21-9d10-0123456789ab'
      const row = mapProcessListRow({ workflow_instance_id: instanceId, status: 'running' })

      // Asserted against the search branches rather than the source text, so
      // the two halves of the feature cannot drift: what the list SHOWS has to
      // be what typing it FINDS.
      expect(row?.subjectLabel).toBe('05CF8116')
      expect(buildExecutionSearchBranches(row!.subjectLabel)?.[1]).toEqual({
        workflow_instance_id: {
          $gte: '05cf8116-0000-0000-0000-000000000000',
          $lte: '05cf8116-ffff-ffff-ffff-ffffffffffff',
        },
      })
    })
  })

  describe('honest copy', () => {
    it.each(locales)('locale %s advertises the id search', (locale) => {
      const data = JSON.parse(read(`i18n/${locale}.json`)) as Record<string, string>
      const placeholder = data['agent_orchestrator.process.list.searchPlaceholder']
      const hint = data['agent_orchestrator.process.list.searchHint']
      expect(placeholder).toBeTruthy()
      expect(hint).toBeTruthy()
      expect(`${placeholder} ${hint}`.toLowerCase()).toContain('id')
    })
  })
})
