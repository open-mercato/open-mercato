/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

const mockLoadActiveProjectMembers = jest.fn()
const mockCreateBatch = jest.fn()
const mockCreateForFeature = jest.fn()
const mockReportError = jest.fn()

jest.mock('../projectAssignment', () => ({
  loadActiveProjectMembers: (...args: unknown[]) => mockLoadActiveProjectMembers(...args),
}))

jest.mock('../../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({
    createBatch: (...args: unknown[]) => mockCreateBatch(...args),
    createForFeature: (...args: unknown[]) => mockCreateForFeature(...args),
  }),
}))

jest.mock('../../../../notifications/lib/notificationBuilder', () => ({
  buildBatchNotificationFromType: (_type: unknown, input: Record<string, unknown>) => ({ ...input }),
  buildFeatureNotificationFromType: (_type: unknown, input: Record<string, unknown>) => ({ ...input }),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

import { notifyProjectWork, resolveProjectWorkRecipients, PROJECT_MANAGERS_FEATURE } from '../workRecipients'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const PROJECT_ID = 'project-1'
const ACTOR = 'actor-user'
const TYPE_DEF = { type: 'staff.test' } as unknown as NotificationTypeDefinition

function emWithOwner(ownerUserId: string | null): EntityManager {
  return {
    findOne: jest.fn(async () => (ownerUserId === undefined ? null : { id: PROJECT_ID, ownerUserId })),
  } as unknown as EntityManager
}

function assigners(...userIds: (string | null)[]) {
  return userIds.map((userId, index) => ({ membershipId: `m${index}`, staffMemberId: `s${index}`, userId, isAssigner: true }))
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('resolveProjectWorkRecipients', () => {
  it('step 1: the type audience, de-duplicated and without the actor', async () => {
    const em = emWithOwner('owner')
    const result = await resolveProjectWorkRecipients(em, SCOPE, {
      timeProjectId: PROJECT_ID,
      audienceUserIds: ['u1', null, 'u1', ACTOR, 'u2'],
      actorUserId: ACTOR,
    })
    expect(result).toEqual({ step: 1, userIds: ['u1', 'u2'] })
    expect(mockLoadActiveProjectMembers).not.toHaveBeenCalled()
  })

  it('step 2: active assigners when the audience is only the actor', async () => {
    mockLoadActiveProjectMembers.mockResolvedValue(assigners('a1', ACTOR, null))
    const result = await resolveProjectWorkRecipients(emWithOwner('owner'), SCOPE, {
      timeProjectId: PROJECT_ID,
      audienceUserIds: [ACTOR],
      actorUserId: ACTOR,
      graceDays: 5,
    })
    expect(result).toEqual({ step: 2, userIds: ['a1'] })
    expect(mockLoadActiveProjectMembers).toHaveBeenCalledWith(expect.anything(), SCOPE, PROJECT_ID, expect.objectContaining({ assignersOnly: true, graceDays: 5 }))
  })

  it('step 3: the project owner when no other assigner is left', async () => {
    mockLoadActiveProjectMembers.mockResolvedValue(assigners(ACTOR))
    const result = await resolveProjectWorkRecipients(emWithOwner('owner'), SCOPE, {
      timeProjectId: PROJECT_ID,
      actorUserId: ACTOR,
    })
    expect(result).toEqual({ step: 3, userIds: ['owner'] })
  })

  it('step 4: hands over to project managers when the owner is the actor', async () => {
    mockLoadActiveProjectMembers.mockResolvedValue([])
    const result = await resolveProjectWorkRecipients(emWithOwner(ACTOR), SCOPE, {
      timeProjectId: PROJECT_ID,
      actorUserId: ACTOR,
    })
    expect(result).toEqual({ step: 4, userIds: [] })
  })

  it('step 4: when the project has no owner and no assigners', async () => {
    mockLoadActiveProjectMembers.mockResolvedValue([])
    const result = await resolveProjectWorkRecipients(emWithOwner(null), SCOPE, { timeProjectId: PROJECT_ID })
    expect(result).toEqual({ step: 4, userIds: [] })
  })
})

describe('notifyProjectWork', () => {
  const container = { resolve: jest.fn() } as unknown as { resolve: <T = unknown>(name: string) => T }
  const build = { groupKey: 'group' }

  it('pins step 4 to the organization-restricted project-manager feature', async () => {
    mockCreateForFeature.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }])
    const result = await notifyProjectWork(container, SCOPE, { typeDef: TYPE_DEF, recipients: { step: 4, userIds: [] }, build })
    expect(result).toEqual({ step: 4, notifiedCount: 2 })
    expect(mockCreateForFeature).toHaveBeenCalledTimes(1)
    const [input, context] = mockCreateForFeature.mock.calls[0]
    expect(input).toEqual(expect.objectContaining({ requiredFeature: PROJECT_MANAGERS_FEATURE, restrictRecipientsToOrganization: true }))
    expect(context).toEqual(SCOPE)
    expect(mockCreateBatch).not.toHaveBeenCalled()
  })

  it('reports nobody when the feature step finds no recipients', async () => {
    mockCreateForFeature.mockResolvedValue([])
    await expect(
      notifyProjectWork(container, SCOPE, { typeDef: TYPE_DEF, recipients: { step: 4, userIds: [] }, build }),
    ).resolves.toEqual({ step: 4, notifiedCount: 0 })
  })

  it('sends a batch to the resolved users for steps 1-3', async () => {
    mockCreateBatch.mockResolvedValue([{ id: 'n1' }])
    const result = await notifyProjectWork(container, SCOPE, { typeDef: TYPE_DEF, recipients: { step: 2, userIds: ['a1'] }, build })
    expect(result).toEqual({ step: 2, notifiedCount: 1 })
    expect(mockCreateBatch).toHaveBeenCalledWith(expect.objectContaining({ recipientUserIds: ['a1'] }), SCOPE)
  })

  it('reports and degrades to zero when the batch send fails', async () => {
    const failure = new Error('boom')
    mockCreateBatch.mockRejectedValue(failure)
    const result = await notifyProjectWork(container, SCOPE, { typeDef: TYPE_DEF, recipients: { step: 1, userIds: ['u1'] }, build })
    expect(result).toEqual({ step: 1, notifiedCount: 0 })
    expect(mockReportError).toHaveBeenCalledWith(failure, expect.objectContaining({ module: 'staff', code: 'staff.project_work_notification_failed' }))
  })
})
