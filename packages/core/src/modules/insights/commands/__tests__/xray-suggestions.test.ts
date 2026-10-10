import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { InsightsAutomationSuggestion } from '../../data/entities'

const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

import { XRAY_SUGGESTION_UPDATE_COMMAND_ID, updateXraySuggestionCommand } from '../xray-suggestions'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_ID = '22222222-0000-4000-8000-000000000001'
const OTHER_ORG_ID = '22222222-0000-4000-8000-000000000002'
const SUGGESTION_ID = '66666666-0000-4000-8000-000000000001'
const WORKFLOW_ID = '55555555-0000-4000-8000-000000000001'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const VERSION = new Date('2026-10-10T10:00:00.123Z')

function stored(overrides: Partial<InsightsAutomationSuggestion> = {}): InsightsAutomationSuggestion {
  return Object.assign(new InsightsAutomationSuggestion(), {
    id: SUGGESTION_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    processKey: 'customers.deal',
    signatureHash: 'a'.repeat(64),
    status: 'open',
    draftedArtifactId: null,
    updatedAt: VERSION,
    deletedAt: null,
    ...overrides,
  })
}

type FakeEm = { fork: () => FakeEm; nativeUpdate: jest.Mock }

function createEm(): FakeEm {
  const em: FakeEm = { fork: () => em, nativeUpdate: jest.fn(async () => 1) }
  return em
}

const draftService = { validateDraftDefinition: jest.fn(), getDefinitionForScope: jest.fn() }

function ctx(em: FakeEm, headers: Record<string, string> = {}, options: { workflows?: boolean } = {}): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'workflowDraftService' && options.workflows !== false) return draftService
        throw new Error(`[internal] unexpected ${name}`)
      },
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: new Request(`http://localhost/api/insights/xray/suggestions/${SUGGESTION_ID}`, { method: 'PATCH', headers }),
  } as unknown as CommandRuntimeContext
}

const base = { tenantId: TENANT_ID, organizationId: ORG_ID, id: SUGGESTION_ID }

describe('insights.xray.suggestion.update', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    draftService.getDefinitionForScope.mockReset()
  })

  it('has the documented command id', () => {
    expect(XRAY_SUGGESTION_UPDATE_COMMAND_ID).toBe('insights.xray.suggestion.update')
    expect(updateXraySuggestionCommand.id).toBe(XRAY_SUGGESTION_UPDATE_COMMAND_ID)
  })

  it('dismisses with a compare-and-set on updated_at when the version header matches', async () => {
    const em = createEm()
    const saved = stored({ status: 'dismissed', updatedAt: new Date('2026-10-10T10:00:01.000Z') })
    findOneWithDecryptionMock.mockResolvedValueOnce(stored()).mockResolvedValueOnce(saved)
    const result = await updateXraySuggestionCommand.execute({ ...base, status: 'dismissed' }, ctx(em, { [LOCK_HEADER]: VERSION.toISOString() }))
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      InsightsAutomationSuggestion,
      { id: SUGGESTION_ID, tenantId: TENANT_ID, organizationId: ORG_ID, updatedAt: VERSION, deletedAt: null },
      expect.objectContaining({ status: 'dismissed', draftedArtifactId: null, updatedAt: expect.any(Date) }),
    )
    const written = em.nativeUpdate.mock.calls[0][2] as { updatedAt: Date }
    expect(written.updatedAt.getTime()).toBeGreaterThan(VERSION.getTime())
    expect(result).toEqual({ id: SUGGESTION_ID, processKey: 'customers.deal', status: 'dismissed', draftedArtifactId: null, updatedAt: '2026-10-10T10:00:01.000Z' })
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      em,
      InsightsAutomationSuggestion,
      { id: SUGGESTION_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
      undefined,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  it('answers the standard 409 for a stale version header without writing', async () => {
    const em = createEm()
    findOneWithDecryptionMock.mockResolvedValueOnce(stored())
    await expect(updateXraySuggestionCommand.execute({ ...base, status: 'dismissed' }, ctx(em, { [LOCK_HEADER]: '2026-10-10T09:59:59.000Z' })))
      .rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'optimistic_lock_conflict', currentUpdatedAt: VERSION.toISOString() }) })
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('answers 409 when a concurrent change (user or mining pass) wins between the check and the write', async () => {
    const em = createEm()
    em.nativeUpdate.mockResolvedValueOnce(0)
    findOneWithDecryptionMock.mockResolvedValueOnce(stored()).mockResolvedValueOnce(stored({ updatedAt: new Date('2026-10-10T10:00:05.000Z') }))
    await expect(updateXraySuggestionCommand.execute({ ...base, status: 'dismissed' }, ctx(em, { [LOCK_HEADER]: VERSION.toISOString() })))
      .rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'optimistic_lock_conflict', currentUpdatedAt: '2026-10-10T10:00:05.000Z', expectedUpdatedAt: VERSION.toISOString() }) })
  })

  it('marks drafted only with a workflow definition of the same tenant and organization', async () => {
    const em = createEm()
    draftService.getDefinitionForScope.mockResolvedValueOnce({ id: WORKFLOW_ID })
    findOneWithDecryptionMock.mockResolvedValueOnce(stored()).mockResolvedValueOnce(stored({ status: 'drafted', draftedArtifactId: WORKFLOW_ID }))
    const result = await updateXraySuggestionCommand.execute({ ...base, status: 'drafted', draftedArtifactId: WORKFLOW_ID }, ctx(em))
    expect(draftService.getDefinitionForScope).toHaveBeenCalledWith(WORKFLOW_ID, { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(em.nativeUpdate.mock.calls[0][2]).toEqual(expect.objectContaining({ status: 'drafted', draftedArtifactId: WORKFLOW_ID }))
    expect(result.status).toBe('drafted')

    draftService.getDefinitionForScope.mockResolvedValueOnce(null)
    findOneWithDecryptionMock.mockResolvedValueOnce(stored())
    await expect(updateXraySuggestionCommand.execute({ ...base, status: 'drafted', draftedArtifactId: WORKFLOW_ID }, ctx(createEm())))
      .rejects.toMatchObject({ status: 422, body: expect.objectContaining({ code: 'drafted_artifact_not_found' }) })
    findOneWithDecryptionMock.mockResolvedValueOnce(stored())
    await expect(updateXraySuggestionCommand.execute({ ...base, status: 'drafted', draftedArtifactId: WORKFLOW_ID }, ctx(createEm(), {}, { workflows: false })))
      .rejects.toMatchObject({ status: 422, body: expect.objectContaining({ code: 'workflows_unavailable' }) })
  })

  it('reopens a drafted suggestion and clears its artifact', async () => {
    const em = createEm()
    findOneWithDecryptionMock.mockResolvedValueOnce(stored({ status: 'drafted', draftedArtifactId: WORKFLOW_ID })).mockResolvedValueOnce(stored())
    await updateXraySuggestionCommand.execute({ ...base, status: 'open' }, ctx(em))
    expect(em.nativeUpdate.mock.calls[0][2]).toEqual(expect.objectContaining({ status: 'open', draftedArtifactId: null }))
  })

  it('refuses to change a superseded suggestion (422) after the lock check', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(stored({ status: 'superseded' }))
    await expect(updateXraySuggestionCommand.execute({ ...base, status: 'dismissed' }, ctx(createEm(), { [LOCK_HEADER]: VERSION.toISOString() })))
      .rejects.toMatchObject({ status: 422, body: expect.objectContaining({ code: 'suggestion_superseded' }) })
  })

  it('answers 404 for an unknown suggestion or one of another organization', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(null)
    await expect(updateXraySuggestionCommand.execute({ ...base, status: 'dismissed' }, ctx(createEm()))).rejects.toMatchObject({ status: 404 })
    findOneWithDecryptionMock.mockResolvedValueOnce(stored({ organizationId: OTHER_ORG_ID }))
    await expect(updateXraySuggestionCommand.execute({ ...base, status: 'dismissed' }, ctx(createEm()))).rejects.toMatchObject({ status: 404 })
  })

  it('refuses another organization than the command context (scope check before any read)', async () => {
    await expect(updateXraySuggestionCommand.execute({ ...base, organizationId: OTHER_ORG_ID, status: 'dismissed' }, ctx(createEm()))).rejects.toMatchObject({ status: 403 })
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('validates the input: drafted needs an artifact, other statuses refuse one', async () => {
    await expect(updateXraySuggestionCommand.execute({ ...base, status: 'drafted' }, ctx(createEm()))).rejects.toBeDefined()
    await expect(updateXraySuggestionCommand.execute({ ...base, status: 'dismissed', draftedArtifactId: WORKFLOW_ID }, ctx(createEm()))).rejects.toBeDefined()
    await expect(updateXraySuggestionCommand.execute({ ...base, status: 'superseded' } as never, ctx(createEm()))).rejects.toBeDefined()
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('logs the status change with before and after snapshots (no actor data)', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(stored())
    const prepared = await updateXraySuggestionCommand.prepare?.({ ...base, status: 'dismissed' }, ctx(createEm()))
    const log = await updateXraySuggestionCommand.buildLog?.({
      input: { ...base, status: 'dismissed' },
      result: { id: SUGGESTION_ID, processKey: 'customers.deal', status: 'dismissed', draftedArtifactId: null, updatedAt: '2026-10-10T10:00:01.000Z' },
      snapshots: { before: prepared?.before },
      ctx: ctx(createEm()),
    } as never)
    expect(log).toEqual(expect.objectContaining({
      resourceKind: 'insights.xray_suggestion',
      resourceId: SUGGESTION_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      snapshotBefore: expect.objectContaining({ status: 'open' }),
      snapshotAfter: expect.objectContaining({ status: 'dismissed' }),
    }))
  })
})
