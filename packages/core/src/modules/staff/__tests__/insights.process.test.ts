import type { EntityManager } from '@mikro-orm/postgresql'
import type { ProcessActorDimensionContext } from '@open-mercato/shared/modules/insights/process'

const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silentLogger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    child: () => silentLogger,
  }
  return { ...actual, createLogger: () => silentLogger }
})

import { buildProcessRegistrySnapshot } from '@open-mercato/core/modules/insights/lib/process/registry'
import processConfig, { resolveActorTeams } from '../insights.process'
import { defaultEncryptionMaps } from '../encryption'
import { StaffTeamMember } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_A = '33333333-3333-4333-8333-333333333333'
const USER_B = '44444444-4444-4444-8444-444444444444'
const USER_C = 'abcdef01-2345-4678-8abc-def012345678'
const TEAM_ONE = '55555555-5555-4555-8555-555555555555'
const TEAM_TWO = '66666666-6666-4666-8666-666666666666'
const MEMBER_IDS = [
  '77777777-7777-4777-8777-777777777771',
  '77777777-7777-4777-8777-777777777772',
  '77777777-7777-4777-8777-777777777773',
  '77777777-7777-4777-8777-777777777774',
  '77777777-7777-4777-8777-777777777775',
  '77777777-7777-4777-8777-777777777776',
]

const em = { marker: 'staff-em' } as unknown as EntityManager

function buildContext(): ProcessActorDimensionContext {
  return { em, tenantId: TENANT_ID, organizationId: ORG_ID }
}

describe('staff insights.process', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockReset()
  })

  describe('config shape', () => {
    it('declares version 1 with the team actor dimension and no processes', () => {
      expect(processConfig.version).toBe(1)
      expect(processConfig.processes).toBeUndefined()
      expect(processConfig.actorDimensions).toEqual([{ kind: 'team', resolve: resolveActorTeams }])
    })

    it('registers the team provider against the real staff encryption maps', () => {
      const snapshot = buildProcessRegistrySnapshot(
        [{ moduleId: 'staff', config: processConfig }],
        [{ moduleId: 'staff', maps: defaultEncryptionMaps }],
      )
      expect(snapshot.rejected).toEqual([])
      expect(snapshot.processes).toEqual([])
      expect(Array.from(snapshot.actorDimensions.keys())).toEqual(['team'])
      expect(snapshot.actorDimensions.get('team')).toEqual({
        moduleId: 'staff',
        provider: { kind: 'team', resolve: resolveActorTeams },
      })
    })
  })

  describe('resolveActorTeams', () => {
    it('reads active, live team members of the tenant and organization in one scoped query', async () => {
      findWithDecryptionMock.mockResolvedValueOnce([])

      await resolveActorTeams(buildContext(), [USER_A, 'not-a-uuid', USER_B, USER_A, '', USER_C])

      expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
      const [calledEm, entity, where, options, scope] = findWithDecryptionMock.mock.calls[0]
      expect(calledEm).toBe(em)
      expect(entity).toBe(StaffTeamMember)
      expect(where).toEqual({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        userId: { $in: [USER_A, USER_B, USER_C] },
        isActive: true,
        deletedAt: null,
      })
      expect(options).toEqual({ fields: ['id', 'userId', 'teamId'] })
      expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
    })

    it('groups team ids per user, deduplicated, skipping members without a team or user', async () => {
      findWithDecryptionMock.mockResolvedValueOnce([
        { id: MEMBER_IDS[0], userId: USER_A, teamId: TEAM_ONE },
        { id: MEMBER_IDS[1], userId: USER_A, teamId: TEAM_TWO },
        { id: MEMBER_IDS[2], userId: USER_A, teamId: TEAM_ONE },
        { id: MEMBER_IDS[3], userId: USER_B, teamId: null },
        { id: MEMBER_IDS[4], userId: USER_C, teamId: TEAM_TWO },
        { id: MEMBER_IDS[5], userId: null, teamId: TEAM_ONE },
      ])

      const teams = await resolveActorTeams(buildContext(), [USER_A, USER_B, USER_C])

      expect(teams).toEqual({
        [USER_A]: [TEAM_ONE, TEAM_TWO],
        [USER_C]: [TEAM_TWO],
      })
      expect(Object.prototype.hasOwnProperty.call(teams, USER_B)).toBe(false)
    })

    it('returns an empty map without querying when no actor id is a UUID', async () => {
      await expect(resolveActorTeams(buildContext(), [])).resolves.toEqual({})
      await expect(resolveActorTeams(buildContext(), ['user-1', '', 'api-key:42'])).resolves.toEqual({})
      expect(findWithDecryptionMock).not.toHaveBeenCalled()
    })

    it('is the resolver the registry hands to the projection', async () => {
      findWithDecryptionMock.mockResolvedValueOnce([{ id: MEMBER_IDS[0], userId: USER_B, teamId: TEAM_ONE }])
      const snapshot = buildProcessRegistrySnapshot([{ moduleId: 'staff', config: processConfig }], [])
      const provider = snapshot.actorDimensions.get('team')?.provider
      if (!provider) throw new Error('[internal] team provider was not registered')

      await expect(provider.resolve(buildContext(), [USER_B])).resolves.toEqual({ [USER_B]: [TEAM_ONE] })
      expect(findWithDecryptionMock.mock.calls[0][2]).toMatchObject({ userId: { $in: [USER_B] } })
    })
  })
})
