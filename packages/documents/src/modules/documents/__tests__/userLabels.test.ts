import type { AuthPrincipalLabel } from '@open-mercato/shared/lib/auth/principal-service'
import { resolveUserLabels, resolveViewerSafeUserLabels } from '../lib/userLabels'

const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000002'
const USER_ID_1 = '00000000-0000-4000-8000-000000000003'
const USER_ID_2 = '00000000-0000-4000-8000-000000000004'
const UNKNOWN_USER_ID = '00000000-0000-4000-8000-000000000005'

function containerWithLabels(labels: AuthPrincipalLabel[]) {
  const resolveLabels = jest.fn(async () => labels)
  return {
    resolve(name: string) {
      if (name !== 'authPrincipalService') throw new Error('missing')
      return {
        principalExists: jest.fn(),
        resolveActiveUserRoleIds: jest.fn(),
        filterActiveRoleIds: jest.fn(),
        resolveLabels,
        listSuperAdminUserIds: jest.fn(),
      }
    },
    resolveLabels,
  }
}

describe('resolveUserLabels', () => {
  it('sanitizes provider labels, omits unknown ids, and dedupes input', async () => {
    const container = containerWithLabels([
      { id: USER_ID_1, label: 'Ada Lovelace', secondary: 'ada@example.test' },
      { id: USER_ID_2, label: 'grace@example.test', secondary: null },
    ])
    const labels = await resolveUserLabels(
      container,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      [USER_ID_1, USER_ID_1, USER_ID_2, UNKNOWN_USER_ID],
    )
    expect(labels.get(USER_ID_1)).toEqual({ label: 'Ada Lovelace', secondary: 'ada@example.test' })
    expect(labels.get(USER_ID_2)).toEqual({ label: 'grace@example.test', secondary: null })
    expect(labels.has(UNKNOWN_USER_ID)).toBe(false)
    expect(container.resolveLabels).toHaveBeenCalledWith({
      type: 'user',
      ids: [USER_ID_1, USER_ID_2, UNKNOWN_USER_ID],
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    })
  })

  it('returns an empty map without resolving a provider for empty input', async () => {
    const container = { resolve: jest.fn(() => { throw new Error('missing') }) }
    const labels = await resolveUserLabels(
      container,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      [],
    )
    expect(labels.size).toBe(0)
    expect(container.resolve).not.toHaveBeenCalled()
  })

  it('fails closed when the Auth principal provider is missing', async () => {
    const labels = await resolveUserLabels(
      { resolve: () => { throw new Error('missing') } },
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      [USER_ID_1],
    )
    expect(labels.size).toBe(0)
  })

  it('never promotes UUID-bearing provider labels into user-visible labels', async () => {
    const container = containerWithLabels([
      { id: USER_ID_1, label: `Agent ${USER_ID_1}`, secondary: `${USER_ID_2}@example.test` },
      { id: USER_ID_2, label: 'safe@example.test', secondary: `Agent ${USER_ID_1}` },
    ])
    const labels = await resolveUserLabels(
      container,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      [USER_ID_1, USER_ID_2],
    )
    expect(labels.has(USER_ID_1)).toBe(false)
    expect(labels.get(USER_ID_2)).toEqual({ label: 'safe@example.test', secondary: null })
  })

  it('projects viewer-safe labels without secondary metadata while keeping an email-only display name', async () => {
    // An account without a display name resolves to its email everywhere else
    // (list owner column, version history); comment authors must match instead
    // of degrading to the "unknown user" placeholder.
    const container = containerWithLabels([
      { id: USER_ID_1, label: 'Ada Lovelace', secondary: 'ada@example.test' },
      { id: USER_ID_2, label: 'grace@example.test', secondary: null },
    ])

    const labels = await resolveViewerSafeUserLabels(
      container,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      [USER_ID_1, USER_ID_2, UNKNOWN_USER_ID],
    )

    expect(Array.from(labels.entries())).toEqual([
      [USER_ID_1, { label: 'Ada Lovelace' }],
      [USER_ID_2, { label: 'grace@example.test' }],
    ])
  })
})
