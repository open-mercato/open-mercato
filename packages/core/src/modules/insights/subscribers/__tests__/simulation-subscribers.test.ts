const deleteSimulationRunsOfUser = jest.fn()
const eraseSimulationDecider = jest.fn()
const deleteSimulationRunsOfScope = jest.fn()

jest.mock('../../lib/simulation/store', () => ({
  deleteSimulationRunsOfUser: (...args: unknown[]) => deleteSimulationRunsOfUser(...args),
  eraseSimulationDecider: (...args: unknown[]) => eraseSimulationDecider(...args),
  deleteSimulationRunsOfScope: (...args: unknown[]) => deleteSimulationRunsOfScope(...args),
}))

import userDeleted, { metadata as userDeletedMetadata } from '../simulation-user-deleted'
import organizationDeleted, { metadata as organizationDeletedMetadata } from '../simulation-organization-deleted'
import tenantDeleted, { metadata as tenantDeletedMetadata } from '../simulation-tenant-deleted'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const JOB = '44444444-4444-4444-8444-444444444444'

function context(progress: { markCancelled: jest.Mock } | null = { markCancelled: jest.fn(async () => ({})) }) {
  const em = { fork: () => em }
  return {
    progress,
    ctx: {
      resolve: <TService>(name: string): TService => {
        if (name === 'em') return em as TService
        if (name === 'progressService' && progress) return progress as TService
        throw new Error(`missing ${name}`)
      },
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  deleteSimulationRunsOfUser.mockResolvedValue({ deleted: 2, progressJobIds: [{ progressJobId: JOB, organizationId: ORG }] })
  eraseSimulationDecider.mockResolvedValue(3)
  deleteSimulationRunsOfScope.mockResolvedValue({ deleted: 1, progressJobIds: [] })
})

describe('simulation GDPR and scope subscribers (S18)', () => {
  it('subscribes persistently to the deletion events', () => {
    expect(userDeletedMetadata).toEqual({ event: 'auth.user.deleted', persistent: true, id: 'insights:simulation-user-deleted' })
    expect(organizationDeletedMetadata).toEqual(expect.objectContaining({ event: 'directory.organization.deleted', persistent: true }))
    expect(tenantDeletedMetadata).toEqual(expect.objectContaining({ event: 'directory.tenant.deleted', persistent: true }))
  })

  it('deletes the user\'s runs, erases decisions and cancels progress jobs of active runs', async () => {
    const { ctx, progress } = context()
    await userDeleted({ id: USER.toUpperCase(), tenantId: TENANT }, ctx)
    expect(deleteSimulationRunsOfUser).toHaveBeenCalledWith(expect.anything(), TENANT, USER)
    expect(eraseSimulationDecider).toHaveBeenCalledWith(expect.anything(), TENANT, USER)
    expect(progress?.markCancelled).toHaveBeenCalledWith(JOB, { tenantId: TENANT, organizationId: ORG, userId: null })
  })

  it('never erases without a tenant and tolerates a missing progress service', async () => {
    await userDeleted({ id: USER }, context().ctx)
    await userDeleted({ id: 'not-a-uuid', tenantId: TENANT }, context().ctx)
    expect(deleteSimulationRunsOfUser).not.toHaveBeenCalled()
    await expect(userDeleted({ userId: USER, tenantId: TENANT }, context(null).ctx)).resolves.toBeUndefined()
    expect(eraseSimulationDecider).toHaveBeenCalledTimes(1)
  })

  it('purges an organization\'s runs with both ids and a tenant\'s runs by its id', async () => {
    await organizationDeleted({ id: ORG, tenantId: TENANT, organizationId: ORG }, context().ctx)
    expect(deleteSimulationRunsOfScope).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT, organizationId: ORG })
    await organizationDeleted({ id: ORG }, context().ctx)
    expect(deleteSimulationRunsOfScope).toHaveBeenCalledTimes(1)
    await tenantDeleted({ id: TENANT, tenantId: null }, context().ctx)
    expect(deleteSimulationRunsOfScope).toHaveBeenLastCalledWith(expect.anything(), { tenantId: TENANT, organizationId: null })
  })
})
