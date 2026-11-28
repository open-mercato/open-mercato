/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const survivorId = '33333333-3333-4333-8333-333333333333'
const sourceId = '44444444-4444-4444-8444-444444444444'
const commandExecute = jest.fn()
const validateMutation = jest.fn()
const afterMutationSuccess = jest.fn()
const reportError = jest.fn()
const userHasAllFeatures = jest.fn()
const findWithDecryption = jest.fn()
const emCount = jest.fn(async (_entity: unknown, _where: unknown) => 0)
const listGrantsForViewer = jest.fn(async (_em: unknown, _scope: unknown, _viewer: unknown) => [
  { personEntityId: 'person-1', ownerUserId: 'mailbox-owner' },
])
const listSharedChannelIds = jest.fn(async (_em: unknown, _scope: unknown, _viewer: unknown) => ['shared-channel'])

const context = {
  auth: { tenantId, orgId: organizationId, sub: 'user-1', isApiKey: false },
  selectedOrganizationId: organizationId,
  em: { count: emCount },
  commandContext: { auth: { tenantId }, selectedOrganizationId: organizationId },
  container: {
    hasRegistration: jest.fn((key: string) => key === 'crudMutationGuardService' || key === 'commandBus'),
    resolve: jest.fn((key: string) => {
      if (key === 'commandBus') return { execute: commandExecute }
      if (key === 'crudMutationGuardService') return { validateMutation, afterMutationSuccess }
      if (key === 'rbacService') return { userHasAllFeatures }
      throw new Error(`Unexpected dependency: ${key}`)
    }),
  },
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: async () => ({}),
}))

jest.mock('../../../../lib/interactionRequestContext', () => ({
  resolveCustomersRequestContext: jest.fn(async () => context),
  resolveAuthActorId: jest.fn(() => 'user-1'),
}))

jest.mock('../../../../lib/conversationShares', () => ({
  listGrantsForViewer: (...args: Parameters<typeof listGrantsForViewer>) => listGrantsForViewer(...args),
  listSharedChannelIds: (...args: Parameters<typeof listSharedChannelIds>) => listSharedChannelIds(...args),
}))

const registryGuards: unknown[] = []

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: () => registryGuards,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  registerEntityMergeParticipant,
  resetEntityMergeParticipantsForTests,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { CustomerComment, CustomerDeal, CustomerInteraction } from '../../../../data/entities'
import { GET, metadata, openApi, POST } from '../route'

const validBody = {
  survivorId,
  sourceId,
  survivorUpdatedAt: '2026-11-24T10:00:00.000Z',
  sourceUpdatedAt: '2026-11-24T10:00:00.000Z',
  values: {
    title: 'Merged deal',
    description: null,
    status: 'open',
    pipelineStage: null,
    pipelineId: null,
    pipelineStageId: null,
    valueAmount: null,
    valueCurrency: null,
    probability: null,
    expectedCloseAt: null,
    ownerUserId: null,
    source: null,
    lossReasonId: null,
    lossNotes: null,
  },
  customFields: {},
  personIds: [],
  companyIds: [],
  primaryPersonEntityId: null,
}

function postRequest(body: unknown) {
  return new Request('http://localhost/api/customers/deals/merge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('customers Deal merge route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    context.auth.isApiKey = false
    userHasAllFeatures.mockResolvedValue(true)
    registryGuards.length = 0
    validateMutation.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { lock: true } })
    afterMutationSuccess.mockResolvedValue(undefined)
    commandExecute.mockResolvedValue({ result: { survivorId, sourceId } })
  })

  it('declares scoped view/manage metadata and OpenAPI operations', () => {
    expect(metadata.GET.requireFeatures).toEqual(['customers.deals.view'])
    expect(metadata.POST.requireFeatures).toEqual(['customers.deals.manage'])
    expect(openApi.tag).toBe('Customers')
    expect(openApi.methods).toEqual(expect.objectContaining({ GET: expect.any(Object), POST: expect.any(Object) }))
  })

  it('runs mutation guards for both Deals and dispatches the merge command', async () => {
    const response = await POST(postRequest(validBody))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, survivorId, sourceId })
    expect(validateMutation).toHaveBeenCalledTimes(2)
    expect(validateMutation.mock.calls.map(([input]) => [input.resourceId, input.operation])).toEqual([
      [survivorId, 'update'],
      [sourceId, 'delete'],
    ])
    for (const [input] of validateMutation.mock.calls) {
      expect(input).toEqual(expect.objectContaining({
        tenantId,
        organizationId,
        resourceKind: 'customers.deal',
      }))
    }
    expect(commandExecute).toHaveBeenCalledWith('customers.deals.merge', {
      input: expect.objectContaining({ survivorId, sourceId }),
      ctx: context.commandContext,
    })
    expect(afterMutationSuccess).toHaveBeenCalledTimes(2)
  })

  it('accepts legacy closure data without closureOutcome', async () => {
    const response = await POST(postRequest({
      ...validBody,
      values: { ...validBody.values, status: 'won' },
    }))
    expect(response.status).toBe(200)
  })

  it('rejects identical records before dispatch', async () => {
    const response = await POST(postRequest({ ...validBody, sourceId: survivorId }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: 'customers.deals.merge.errors.validation_failed',
    }))
    expect(commandExecute).not.toHaveBeenCalled()
  })

  it('stops when the survivor guard rejects', async () => {
    validateMutation.mockResolvedValueOnce({ ok: false, status: 423, body: { error: 'locked' } })
    const response = await POST(postRequest(validBody))

    expect(response.status).toBe(423)
    expect(validateMutation).toHaveBeenCalledTimes(1)
    expect(commandExecute).not.toHaveBeenCalled()
    expect(afterMutationSuccess).not.toHaveBeenCalled()
  })

  it('stops when the source guard rejects', async () => {
    validateMutation
      .mockResolvedValueOnce({ ok: true, shouldRunAfterSuccess: true })
      .mockResolvedValueOnce({ ok: false, status: 409, body: { error: 'locked' } })
    const response = await POST(postRequest(validBody))

    expect(response.status).toBe(409)
    expect(validateMutation.mock.calls[1][0].resourceId).toBe(sourceId)
    expect(commandExecute).not.toHaveBeenCalled()
    expect(afterMutationSuccess).not.toHaveBeenCalled()
  })

  it.each([
    ['survivorId', { survivorId: '55555555-5555-4555-8555-555555555555' }],
    ['sourceId', { sourceId: '55555555-5555-4555-8555-555555555555' }],
    ['both ids swapped', { survivorId: sourceId, sourceId: survivorId }],
  ])('rejects a guard rewrite of %s and never runs the command', async (_label, rewrite) => {
    const guardValidate = jest.fn(async () => ({ ok: true, modifiedPayload: rewrite }))
    registryGuards.push({
      id: 'test.retarget',
      targetEntity: 'customers.deal',
      operations: ['update', 'delete'],
      validate: guardValidate,
    })
    const response = await POST(postRequest(validBody))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'customers.deals.merge.errors.guard_retarget',
      code: 'guard_retarget_rejected',
    })
    expect(guardValidate).toHaveBeenCalledTimes(1)
    expect(commandExecute).not.toHaveBeenCalled()
    expect(afterMutationSuccess).not.toHaveBeenCalled()
  })

  it('applies a guard rewrite that keeps both Deal ids and executes with the evaluated ids', async () => {
    registryGuards.push({
      id: 'test.title',
      targetEntity: 'customers.deal',
      operations: ['update', 'delete'],
      validate: async () => ({
        ok: true,
        modifiedPayload: { survivorId, sourceId, values: { ...validBody.values, title: 'Guarded title' } },
      }),
    })
    const response = await POST(postRequest(validBody))

    expect(response.status).toBe(200)
    expect(commandExecute).toHaveBeenCalledTimes(1)
    expect(commandExecute).toHaveBeenCalledWith('customers.deals.merge', {
      input: expect.objectContaining({
        survivorId,
        sourceId,
        values: expect.objectContaining({ title: 'Guarded title' }),
      }),
      ctx: context.commandContext,
    })
  })

  it('normalizes an exact amount string without float conversion before dispatch', async () => {
    const response = await POST(postRequest({
      ...validBody,
      values: { ...validBody.values, valueAmount: '12345678901234567.89' },
    }))

    expect(response.status).toBe(200)
    expect(commandExecute.mock.calls[0][1].input.values.valueAmount).toBe('12345678901234567.89')
  })

  it('returns the structured optimistic-lock conflict when the command reports a gone source', async () => {
    const body = {
      error: 'record_modified',
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: validBody.sourceUpdatedAt,
      expectedUpdatedAt: validBody.sourceUpdatedAt,
    }
    commandExecute.mockRejectedValueOnce(new CrudHttpError(409, body))
    const response = await POST(postRequest(validBody))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual(body)
    expect(afterMutationSuccess).not.toHaveBeenCalled()
  })

  it('maps a command interceptor rejection to its HTTP status and body', async () => {
    commandExecute.mockRejectedValueOnce(new CommandInterceptorError('blocked', { status: 422, body: { error: 'merge_blocked' } }))
    const response = await POST(postRequest(validBody))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'merge_blocked' })
    expect(reportError).not.toHaveBeenCalled()
    expect(afterMutationSuccess).not.toHaveBeenCalled()
  })

  it('keeps a committed merge successful when an after-success callback fails', async () => {
    afterMutationSuccess.mockRejectedValueOnce(new Error('callback failed'))
    const response = await POST(postRequest(validBody))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, survivorId, sourceId })
    expect(afterMutationSuccess).toHaveBeenCalledTimes(2)
    expect(reportError).not.toHaveBeenCalled()
  })

  describe('GET preview', () => {
    const dealRow = (id: string) => ({
      id,
      tenantId,
      organizationId,
      title: `Deal ${id}`,
      status: 'open',
      createdAt: new Date('2026-11-24T10:00:00.000Z'),
      updatedAt: new Date('2026-11-24T10:00:00.000Z'),
    })
    const previewFor = (participantId: string) => jest.fn(async () => ({
      participantId,
      label: participantId,
      sourceCount: 1,
      survivorCount: 0,
      overlapCount: 0,
    }))
    const gatedPreview = previewFor('gated.records')
    const openPreview = previewFor('open.records')

    beforeEach(() => {
      resetEntityMergeParticipantsForTests()
      findWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) =>
        entity === CustomerDeal ? [dealRow(survivorId), dealRow(sourceId)] : [])
      registerEntityMergeParticipant({
        id: 'gated.records',
        entityId: 'customers:customer_deal',
        previewFeatures: ['gated.view'],
        preview: gatedPreview,
        merge: async () => ({ moved: 0, deduplicated: 0 }),
      })
      registerEntityMergeParticipant({
        id: 'open.records',
        entityId: 'customers:customer_deal',
        preview: openPreview,
        merge: async () => ({ moved: 0, deduplicated: 0 }),
      })
    })

    afterAll(() => resetEntityMergeParticipantsForTests())

    const getRequest = () => new Request(`http://localhost/api/customers/deals/merge?left=${survivorId}&right=${sourceId}`)

    it('omits participant counts the caller may not view in the owning module', async () => {
      userHasAllFeatures.mockResolvedValue(false)
      const response = await GET(getRequest())

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.participants.map((entry: { participantId: string }) => entry.participantId)).toEqual(['open.records'])
      expect(gatedPreview).not.toHaveBeenCalled()
      expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['gated.view'], { tenantId, organizationId })
    })

    it('includes participant counts when the caller holds the module view feature', async () => {
      userHasAllFeatures.mockResolvedValue(true)
      const response = await GET(getRequest())

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.participants.map((entry: { participantId: string }) => entry.participantId))
        .toEqual(['gated.records', 'open.records'])
    })

    it('counts only live interactions visible to the caller and live comments', async () => {
      const response = await GET(getRequest())

      expect(response.status).toBe(200)
      const scope = { tenantId, organizationId }
      expect(listGrantsForViewer).toHaveBeenCalledTimes(1)
      expect(listGrantsForViewer).toHaveBeenCalledWith(context.em, scope, 'user-1')
      expect(listSharedChannelIds).toHaveBeenCalledTimes(1)
      expect(listSharedChannelIds).toHaveBeenCalledWith(context.em, scope, 'user-1')
      for (const dealId of [survivorId, sourceId]) {
        expect(emCount).toHaveBeenCalledWith(CustomerComment, { ...scope, deal: dealId, deletedAt: null })
        expect(emCount).toHaveBeenCalledWith(CustomerInteraction, {
          ...scope,
          dealId,
          deletedAt: null,
          $or: [
            { interactionType: { $ne: 'email' } },
            { visibility: null },
            { visibility: { $ne: 'private' } },
            { authorUserId: 'user-1' },
            { entity: 'person-1', authorUserId: 'mailbox-owner' },
            { channelId: { $in: ['shared-channel'] } },
          ],
        })
      }
    })

    it('returns zero without counting records or loading email shares for a Deal-only viewer', async () => {
      userHasAllFeatures.mockResolvedValue(false)

      const response = await GET(getRequest())

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.left.counts).toEqual({ activities: 0, comments: 0, interactions: 0 })
      expect(body.right.counts).toEqual({ activities: 0, comments: 0, interactions: 0 })
      expect(emCount).not.toHaveBeenCalled()
      expect(listGrantsForViewer).not.toHaveBeenCalled()
      expect(listSharedChannelIds).not.toHaveBeenCalled()
      expect(userHasAllFeatures).toHaveBeenCalledWith(
        'user-1', ['customers.activities.view'], { tenantId, organizationId },
      )
      expect(userHasAllFeatures).toHaveBeenCalledWith(
        'user-1', ['customers.interactions.view'], { tenantId, organizationId },
      )
    })

    it('counts no private email on the basis of an API key identity', async () => {
      context.auth.isApiKey = true
      listGrantsForViewer.mockResolvedValueOnce([])
      listSharedChannelIds.mockResolvedValueOnce([])

      const response = await GET(getRequest())

      expect(response.status).toBe(200)
      const scope = { tenantId, organizationId }
      expect(listGrantsForViewer).toHaveBeenCalledWith(context.em, scope, null)
      expect(listSharedChannelIds).toHaveBeenCalledWith(context.em, scope, null)
      expect(emCount).toHaveBeenCalledWith(CustomerInteraction, {
        ...scope,
        dealId: survivorId,
        deletedAt: null,
        $or: [
          { interactionType: { $ne: 'email' } },
          { visibility: null },
          { visibility: { $ne: 'private' } },
        ],
      })
    })

    it('returns the stored amount as an exact decimal string', async () => {
      userHasAllFeatures.mockResolvedValue(true)
      findWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) =>
        entity === CustomerDeal
          ? [{ ...dealRow(survivorId), valueAmount: '12345678901234567.89' }, dealRow(sourceId)]
          : [])
      const response = await GET(getRequest())

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.left.fields.valueAmount).toBe('12345678901234567.89')
      expect(body.right.fields.valueAmount).toBeNull()
    })

    it('returns 404 when one Deal is outside the selected scope', async () => {
      findWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) =>
        entity === CustomerDeal ? [dealRow(survivorId)] : [])
      const response = await GET(getRequest())

      expect(response.status).toBe(404)
      expect(gatedPreview).not.toHaveBeenCalled()
      expect(openPreview).not.toHaveBeenCalled()
    })
  })

  it('logs and reports unexpected failures with a translated error key', async () => {
    commandExecute.mockRejectedValueOnce(new Error('boom'))
    const response = await POST(postRequest(validBody))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'customers.deals.merge.errors.merge_failed' })
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      module: 'customers',
      code: 'customers.deal_merge_failed',
    }))
  })
})
