import { getRecipientUserIdsForFeature } from '../../../notifications/lib/notificationRecipients'
import { MANAGE_PROJECTS_FEATURE } from '../../lib/time-tracking/access'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '99999999-9999-4999-8999-999999999999'
const organizationId = '22222222-2222-4222-8222-222222222222'
const requesterUserId = '33333333-3333-4333-8333-333333333333'
const projectId = '44444444-4444-4444-8444-444444444444'

const createForFeature = jest.fn(async () => [] as unknown[])

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({
    createForFeature: (...args: unknown[]) => createForFeature(...(args as [])),
  }),
}))

import handle, {
  metadata,
  buildProjectAccessRequestLinkHref,
  buildProjectAccessRequestGroupKey,
} from '../time-project-access-requested-notification'

const ctx = { resolve: <T,>(_name: string) => ({}) as T }

const basePayload = {
  tenantId: tenantA,
  organizationId,
  requesterUserId,
  requesterName: 'Tomasz Iwan',
  timeProjectId: projectId,
  timeProjectName: 'Fintechly Portal',
  requestedAt: '2026-08-12T09:00:00.000Z',
}

describe('staff time project access requested notification subscriber', () => {
  beforeEach(() => {
    createForFeature.mockClear()
    createForFeature.mockImplementation(async () => [])
  })

  it('subscribes persistently to the declared access-request event', () => {
    expect(metadata.event).toBe('staff.timesheets.project_access.requested')
    expect(metadata.persistent).toBe(true)
  })

  it('deep-links the project team drawer with the requester pre-selected', () => {
    expect(
      buildProjectAccessRequestLinkHref({ requesterUserId, timeProjectId: projectId }),
    ).toBe(`/backend/staff/time-tracking/projects/${projectId}?panel=team&requesterUserId=${requesterUserId}`)
  })

  it('links a general request to the projects list', () => {
    expect(buildProjectAccessRequestLinkHref({ requesterUserId, timeProjectId: null })).toBe(
      '/backend/staff/time-tracking/projects',
    )
  })

  it('fans the request out to the manage-feature holders in the caller scope', async () => {
    await handle(basePayload, ctx)

    expect(createForFeature).toHaveBeenCalledTimes(1)
    const [input, scope] = createForFeature.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(input).toMatchObject({
      type: 'staff.timesheets.project_access.requested',
      requiredFeature: MANAGE_PROJECTS_FEATURE,
      restrictRecipientsToOrganization: true,
      sourceEntityType: 'staff:time_project',
      sourceEntityId: projectId,
      titleKey: 'staff.notifications.timeProjectAccess.requested.title',
      bodyKey: 'staff.notifications.timeProjectAccess.requested.body',
      linkHref: `/backend/staff/time-tracking/projects/${projectId}?panel=team&requesterUserId=${requesterUserId}`,
      groupKey: buildProjectAccessRequestGroupKey({ requesterUserId, timeProjectId: projectId }),
    })
    expect(input.bodyVariables).toEqual({
      requesterName: 'Tomasz Iwan',
      projectName: 'Fintechly Portal',
    })
    expect(scope).toEqual({ tenantId: tenantA, organizationId })
  })

  it('omits the project source and name for a general request', async () => {
    await handle({ ...basePayload, timeProjectId: null, timeProjectName: null }, ctx)

    const [input] = createForFeature.mock.calls[0] as [Record<string, unknown>]
    expect(input.sourceEntityId).toBeUndefined()
    expect(input.linkHref).toBe('/backend/staff/time-tracking/projects')
    expect(input.bodyVariables).toEqual({ requesterName: 'Tomasz Iwan' })
  })

  it('falls back to the requester id when no display name travelled with the event', async () => {
    await handle({ ...basePayload, requesterName: null }, ctx)

    const [input] = createForFeature.mock.calls[0] as [Record<string, unknown>]
    expect(input.bodyVariables).toEqual({
      requesterName: requesterUserId,
      projectName: 'Fintechly Portal',
    })
  })

  it('does not throw when the scope holds no manage-feature recipients', async () => {
    createForFeature.mockImplementation(async () => [])

    await expect(handle(basePayload, ctx)).resolves.toBeUndefined()
  })

  it('swallows a notification service failure instead of failing the subscriber', async () => {
    createForFeature.mockImplementation(async () => {
      throw new Error('[internal] notification service down')
    })

    await expect(handle(basePayload, ctx)).resolves.toBeUndefined()
  })

  it('ignores a payload without a tenant or requester', async () => {
    await handle({ ...basePayload, tenantId: '' }, ctx)
    await handle({ ...basePayload, requesterUserId: '' }, ctx)

    expect(createForFeature).not.toHaveBeenCalled()
  })
})

type AclFixture = {
  source: 'user' | 'role'
  user_id: string
  tenant_id: string
  features_json: unknown
  is_super_admin: boolean
}

/**
 * Minimal Kysely stand-in for the recipient resolver the subscriber relies on.
 * It reproduces the two things the fan-out must guarantee: wildcard grants count
 * as the manage feature, and the tenant filter never lets another tenant's
 * manager through.
 */
function createFakeDb(fixtures: AclFixture[]) {
  return {
    selectFrom(table: string) {
      const source: AclFixture['source'] = table === 'user_acls' ? 'user' : 'role'
      const filters: Array<{ column: string; value: unknown }> = []
      const chain = {
        innerJoin: () => chain,
        where: (column: string, _operator: string, value: unknown) => {
          filters.push({ column, value })
          return chain
        },
        select: () => chain,
        execute: async () => {
          const tenantFilter = filters.find((filter) => filter.column.endsWith('tenant_id'))
          return fixtures.filter(
            (row) => row.source === source && (!tenantFilter || row.tenant_id === tenantFilter.value),
          )
        },
      }
      return chain
    },
  }
}

describe('manage-feature recipient resolution', () => {
  const fixtures: AclFixture[] = [
    {
      source: 'user',
      user_id: 'exact-grant-user',
      tenant_id: tenantA,
      features_json: [MANAGE_PROJECTS_FEATURE],
      is_super_admin: false,
    },
    {
      source: 'role',
      user_id: 'wildcard-grant-user',
      tenant_id: tenantA,
      features_json: ['staff.*'],
      is_super_admin: false,
    },
    {
      source: 'user',
      user_id: 'unrelated-user',
      tenant_id: tenantA,
      features_json: ['staff.timesheets.view'],
      is_super_admin: false,
    },
    {
      source: 'role',
      user_id: 'other-tenant-manager',
      tenant_id: tenantB,
      features_json: [MANAGE_PROJECTS_FEATURE],
      is_super_admin: false,
    },
  ]

  it('includes wildcard-granted managers and excludes everyone else in the tenant', async () => {
    const recipients = await getRecipientUserIdsForFeature(
      createFakeDb(fixtures) as never,
      tenantA,
      MANAGE_PROJECTS_FEATURE,
    )

    expect(recipients.sort()).toEqual(['exact-grant-user', 'wildcard-grant-user'])
  })

  it('never notifies a manage-feature holder from another tenant', async () => {
    const recipients = await getRecipientUserIdsForFeature(
      createFakeDb(fixtures) as never,
      tenantB,
      MANAGE_PROJECTS_FEATURE,
    )

    expect(recipients).toEqual(['other-tenant-manager'])
    expect(recipients).not.toContain('exact-grant-user')
    expect(recipients).not.toContain('wildcard-grant-user')
  })
})
