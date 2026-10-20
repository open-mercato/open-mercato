import type { ActionLogFieldHistoryQuery } from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import { resolveExplainScanMax, scanResourceHistory } from '../scan'
import { createExplainFeatureChecker, isOrganizationInScope, resolveExplainViewer, resolveExplainVisibility } from '../viewer'
import { isExplainDetailInScope } from '../causes'
import { buildViewer, historyEntry, ORG_A, ORG_B, TENANT_ID, VIEWER_ID } from '../../__tests__/explainTestSupport'

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(),
}))

function reader(total: number) {
  const entries = Array.from({ length: total }, (_unused, index) => historyEntry({
    at: new Date(Date.UTC(2026, 9, 8, 12, 0, 0) - index * 1000).toISOString(),
  }))
  return {
    entries,
    findFieldHistory: jest.fn(async (query: ActionLogFieldHistoryQuery) => {
      const start = query.before ? entries.findIndex((entry) => entry.logId === query.before?.id) + 1 : 0
      const slice = entries.slice(start, start + query.limit)
      const last = slice.at(-1)
      return { entries: slice, nextBefore: slice.length === query.limit && last ? { at: last.cursorAt, id: last.logId } : null }
    }),
  }
}

const scanParams = {
  tenantId: TENANT_ID,
  organizationIds: [ORG_A],
  resourceKinds: ['test.deal'],
  resourceId: 'deal-1',
  includeChildren: false,
  before: null,
}

describe('scanResourceHistory', () => {
  it('stops at the end of history without flagging truncation, even at an exact multiple of the batch size', async () => {
    const history = reader(200)
    const result = await scanResourceHistory(history, { ...scanParams, scanMax: 500 })

    expect(result.scanned).toBe(200)
    expect(result.truncated).toBe(false)
    expect(history.findFieldHistory).toHaveBeenCalledTimes(3)
  })

  it('flags truncation only when more rows exist beyond the budget', async () => {
    const exact = reader(500)
    const exactResult = await scanResourceHistory(exact, { ...scanParams, scanMax: 500 })
    expect(exactResult).toEqual(expect.objectContaining({ scanned: 500, truncated: false }))
    expect(exact.findFieldHistory).toHaveBeenCalledTimes(5)
    expect(exact.findFieldHistory.mock.calls.at(-1)?.[0].limit).toBe(101)

    const larger = reader(501)
    const largerResult = await scanResourceHistory(larger, { ...scanParams, scanMax: 500 })
    expect(largerResult).toEqual(expect.objectContaining({ scanned: 500, truncated: true }))
    expect(largerResult.lastCursor).toEqual({ at: larger.entries[499].cursorAt, id: larger.entries[499].logId })
  })

  it('forwards scope and the starting cursor', async () => {
    const history = reader(3)
    await scanResourceHistory(history, { ...scanParams, before: { at: history.entries[0].cursorAt, id: history.entries[0].logId }, scanMax: 10 })

    expect(history.findFieldHistory).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      organizationIds: [ORG_A],
      before: { at: history.entries[0].cursorAt, id: history.entries[0].logId },
      limit: 11,
    }))
  })
})

describe('resolveExplainScanMax', () => {
  it('reads the env budget with a default and a ceiling', () => {
    expect(resolveExplainScanMax({})).toBe(500)
    expect(resolveExplainScanMax({ OM_INSIGHTS_EXPLAIN_SCAN_MAX: '250' })).toBe(250)
    expect(resolveExplainScanMax({ OM_INSIGHTS_EXPLAIN_SCAN_MAX: '-1' })).toBe(500)
    expect(resolveExplainScanMax({ OM_INSIGHTS_EXPLAIN_SCAN_MAX: '99999' })).toBe(5000)
  })
})

describe('resolveExplainViewer', () => {
  async function resolveWith(scope: Record<string, unknown>, auth: Record<string, unknown> = { sub: VIEWER_ID, tenantId: TENANT_ID, orgId: ORG_A }) {
    const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({ organizationId: null, scope, allowedOrganizationIds: null })
    return resolveExplainViewer({ container: {} as never, auth: auth as never, requiredFeatures: ['insights.explain.view'] })
  }

  it.each([
    ['unrestricted all organizations', { selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID }, null],
    ['restricted all organizations', { selectedId: null, filterIds: [ORG_A, ORG_B], allowedIds: [ORG_A, ORG_B], tenantId: TENANT_ID }, [ORG_A, ORG_B]],
    ['explicitly empty', { selectedId: null, filterIds: [], allowedIds: [], tenantId: TENANT_ID }, []],
    ['a selected organization', { selectedId: ORG_A, filterIds: [ORG_A, ORG_B], allowedIds: null, tenantId: TENANT_ID }, [ORG_A]],
  ])('maps %s to the organization filter', async (_label, scope, expected) => {
    const viewer = await resolveWith(scope)
    expect(viewer?.organizationIds).toEqual(expected)
    expect(viewer?.tenantId).toBe(TENANT_ID)
  })

  it('fails closed without a resolved tenant or a canonical subject', async () => {
    expect(await resolveWith({ selectedId: null, filterIds: null, allowedIds: null, tenantId: null }, { sub: VIEWER_ID, tenantId: null })).toBeNull()
    expect(await resolveWith({ selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID }, { sub: '', tenantId: TENANT_ID })).toBeNull()
  })
})

describe('createExplainFeatureChecker', () => {
  it('memoizes checks per feature set and passes the viewer scope', async () => {
    const rbac = { userHasAllFeatures: jest.fn(async (_userId: string, required: string[]) => !required.includes('denied')) }
    const checker = createExplainFeatureChecker(rbac as never, buildViewer())

    expect(await checker.has(['b', 'a'])).toBe(true)
    expect(await checker.has(['a', 'b'])).toBe(true)
    expect(rbac.userHasAllFeatures).toHaveBeenCalledTimes(1)
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(VIEWER_ID, ['b', 'a'], { tenantId: TENANT_ID, organizationId: ORG_A })

    const gate = await checker.prepare([['denied'], ['a', 'b'], undefined])
    expect(gate(['denied'])).toBe(false)
    expect(gate(['b', 'a'])).toBe(true)
    expect(gate(['never-prepared'])).toBe(false)
  })

  it('fails closed for an absent or empty required feature list, while the per-field gate treats an absent list as no extra requirement', async () => {
    const rbac = { userHasAllFeatures: jest.fn(async () => true) }
    const checker = createExplainFeatureChecker(rbac as never, buildViewer())

    expect(await checker.has(undefined)).toBe(false)
    expect(await checker.has([])).toBe(false)
    expect(await checker.has(['', ''])).toBe(false)
    expect(rbac.userHasAllFeatures).not.toHaveBeenCalled()

    const gate = await checker.prepare([undefined, []])
    expect(gate(undefined)).toBe(true)
    expect(gate([])).toBe(true)
    expect(gate([''])).toBe(false)
    expect(gate(['a', ''])).toBe(false)
  })

  it('evaluates checks at the bound organization and falls back to the viewer organization for tenant-level records', async () => {
    const rbac = { userHasAllFeatures: jest.fn(async () => true) }
    const viewer = buildViewer({ organizationIds: [ORG_A, ORG_B], rbacOrganizationId: null })

    const bound = createExplainFeatureChecker(rbac as never, viewer, { organizationId: ORG_B })
    await bound.has(['audit_logs.view_tenant'])
    expect(bound.organizationId).toBe(ORG_B)
    expect(rbac.userHasAllFeatures).toHaveBeenLastCalledWith(VIEWER_ID, ['audit_logs.view_tenant'], { tenantId: TENANT_ID, organizationId: ORG_B })

    const tenantLevel = createExplainFeatureChecker(rbac as never, viewer, { organizationId: null })
    await tenantLevel.has(['audit_logs.view_tenant'])
    expect(tenantLevel.organizationId).toBeNull()
    expect(rbac.userHasAllFeatures).toHaveBeenLastCalledWith(VIEWER_ID, ['audit_logs.view_tenant'], { tenantId: TENANT_ID, organizationId: null })
  })

  it('derives the visibility matrix from audit features', async () => {
    const rbac = { userHasAllFeatures: jest.fn(async (_userId: string, required: string[]) => required[0] === 'audit_logs.view_self') }
    const visibility = await resolveExplainVisibility(createExplainFeatureChecker(rbac as never, buildViewer()))
    expect(visibility).toEqual({ canSeeActors: false, canSeePastValues: false, canSeeOwnValues: true })
  })
})

describe('isExplainDetailInScope', () => {
  const scope = (viewerOrganizationIds: string[] | null, recordOrganizationId: string | null) => ({ viewerOrganizationIds, recordOrganizationId })

  it('keeps organization details to the record organization, which is where features were checked', () => {
    expect(isExplainDetailInScope(ORG_A, scope([ORG_A], ORG_A))).toBe(true)
    expect(isExplainDetailInScope(ORG_B, scope([ORG_A, ORG_B], ORG_A))).toBe(false)
    expect(isExplainDetailInScope(ORG_B, scope(null, ORG_A))).toBe(false)
    expect(isExplainDetailInScope(ORG_B, scope([ORG_A, ORG_B], null))).toBe(true)
    expect(isExplainDetailInScope(ORG_B, scope([ORG_A], null))).toBe(false)
  })

  it('shows tenant-level details only to tenant-wide viewers, on tenant-level records, or for code identifiers', () => {
    expect(isExplainDetailInScope(null, scope(null, ORG_A))).toBe(true)
    expect(isExplainDetailInScope(undefined, scope(null, ORG_A))).toBe(true)
    expect(isExplainDetailInScope(null, scope([ORG_A], null))).toBe(true)
    expect(isExplainDetailInScope(null, scope([ORG_A], ORG_A))).toBe(false)
    expect(isExplainDetailInScope(undefined, scope([ORG_A, ORG_B], ORG_B))).toBe(false)
    expect(isExplainDetailInScope(null, scope([ORG_A], ORG_A), { codeIdentifier: true })).toBe(true)
  })
})

describe('isOrganizationInScope', () => {
  it('treats null scope as tenant-wide and requires membership otherwise', () => {
    expect(isOrganizationInScope(null, null)).toBe(true)
    expect(isOrganizationInScope(ORG_A, [ORG_A])).toBe(true)
    expect(isOrganizationInScope(ORG_B, [ORG_A])).toBe(false)
    expect(isOrganizationInScope(null, [ORG_A])).toBe(false)
  })
})
