/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { Incident, IncidentParticipant, type IncidentEscalationStep } from '../data/entities'
import { resolveStepRecipients } from '../services/escalationService'

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const INCIDENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OWNER_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const DIRECT_USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const ROLE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const ROLE_USER_ID = '11111111-1111-4111-8111-111111111111'
const TEAM_ID = '22222222-2222-4222-8222-222222222222'
const TEAM_USER_ID = '33333333-3333-4333-8333-333333333333'

const scope = { organizationId: ORG_ID, tenantId: TENANT_ID }

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: INCIDENT_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    ownerUserId: OWNER_USER_ID,
    ...overrides,
  } as Incident
}

function makeStep(targets: IncidentEscalationStep['targets']): IncidentEscalationStep {
  return { delayMinutes: 5, targets, notifyStrategy: 'all' }
}

function makeEntityManager(participants: Array<Partial<IncidentParticipant>> = []): EntityManager {
  return {
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== IncidentParticipant) return []
      return participants
        .filter((participant) => participant.roleId === where.roleId)
        .map((participant) => participant as IncidentParticipant)
    }),
  } as unknown as EntityManager
}

describe('incident escalation recipient resolution', () => {
  test('keeps owner fallback and direct user targets without duplicates', async () => {
    const em = makeEntityManager()

    const result = await resolveStepRecipients(
      em,
      scope,
      makeIncident(),
      makeStep([
        { type: 'user', id: DIRECT_USER_ID },
        { type: 'user', id: OWNER_USER_ID },
      ]),
    )

    expect(result.recipients).toEqual([
      { userId: OWNER_USER_ID },
      { userId: DIRECT_USER_ID },
    ])
  })

  test('resolves role targets from incident participants', async () => {
    const em = makeEntityManager([
      {
        incidentId: INCIDENT_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        roleId: ROLE_ID,
        userId: ROLE_USER_ID,
        deletedAt: null,
      },
    ])

    const result = await resolveStepRecipients(
      em,
      scope,
      makeIncident({ ownerUserId: null }),
      makeStep([{ type: 'role', id: ROLE_ID }]),
    )

    expect(result.recipients).toEqual([{ userId: ROLE_USER_ID }])
    expect((em.find as jest.Mock).mock.calls[0]).toEqual([
      IncidentParticipant,
      {
        incidentId: INCIDENT_ID,
        roleId: ROLE_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
      },
    ])
  })

  test('resolves team targets through the optional staff resolver', async () => {
    const em = makeEntityManager()
    const resolveIncidentTeamRecipients = jest.fn(async () => [
      { userId: TEAM_USER_ID, label: 'Primary on-call' },
      { userId: OWNER_USER_ID, label: 'Duplicate owner' },
    ])
    const container = {
      resolve: jest.fn(() => ({ resolveIncidentTeamRecipients })),
    }
    const now = new Date('2026-07-03T08:00:00.000Z')

    const result = await resolveStepRecipients(
      em,
      scope,
      makeIncident(),
      makeStep([{ type: 'team', id: TEAM_ID }]),
      { container, now },
    )

    expect(container.resolve).toHaveBeenCalledWith('staffTeamMemberResolver', { allowUnregistered: true })
    expect(resolveIncidentTeamRecipients).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      teamId: TEAM_ID,
      at: now,
    })
    expect(result.recipients).toEqual([
      { userId: OWNER_USER_ID },
      { userId: TEAM_USER_ID, label: 'Primary on-call' },
    ])
  })

  test('preserves fallback behavior when staff is absent', async () => {
    const em = makeEntityManager()
    const container = {
      resolve: jest.fn(() => {
        throw new Error('not registered')
      }),
    }

    const result = await resolveStepRecipients(
      em,
      scope,
      makeIncident(),
      makeStep([{ type: 'team', id: TEAM_ID }]),
      { container },
    )

    expect(result.recipients).toEqual([{ userId: OWNER_USER_ID }])
  })
})
