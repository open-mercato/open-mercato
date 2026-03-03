import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  buildPrecedentChecksum,
  buildProjectedEntityLinks,
  buildProjectedWhyLinks,
  createDecisionProjectorService,
} from '../decision-projector-service'
import type { AgentGovernanceDecisionEvent } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const mockedFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

function createEvent(overrides?: Partial<AgentGovernanceDecisionEvent>): AgentGovernanceDecisionEvent {
  return {
    id: 'efb5db5b-4b14-4983-b17c-2d9e51debd6f',
    tenantId: '34d27491-8ce2-41db-a613-11f3ef7c3216',
    organizationId: '43fc92fa-c198-49e0-ab6f-3eb4efed95c8',
    runId: '3ec4dd6e-eecb-49d6-8d22-854e6f75f951',
    stepId: 'step-1',
    actionType: 'policy.update',
    targetEntity: 'agent_governance_policy',
    targetId: '7f396217-151e-4d16-978e-cafe6ed0132a',
    policyId: 'd70f8ab7-617a-4f53-8c6f-e6ac5299f503',
    riskBandId: '66d9631f-18d4-4e54-84da-6f3a2fb5c126',
    riskScore: 30,
    controlPath: 'override',
    inputEvidence: ['customers:123', 'customers:123', 'trace-raw'],
    approverIds: ['64c66cc9-fea8-49fa-b94b-e4724f49cd2c'],
    exceptionIds: ['exception-1'],
    writeSet: { operation: 'update', field: 'name' },
    status: 'success',
    errorCode: null,
    harnessProvider: 'opencode',
    immutableHash: 'hash-1',
    supersedesEventId: null,
    signature: 'signature-1',
    createdAt: new Date('2026-03-03T10:00:00.000Z'),
    ...overrides,
  } as AgentGovernanceDecisionEvent
}

function createFakeEm(): EntityManager {
  return {
    nativeDelete: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => payload),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  } as unknown as EntityManager
}

describe('decision-projector-service', () => {
  beforeEach(() => {
    mockedFindOneWithDecryption.mockReset()
  })

  test('builds deduplicated entity links and why links', () => {
    const event = createEvent()

    const entityLinks = buildProjectedEntityLinks(event)
    const whyLinks = buildProjectedWhyLinks(event)

    expect(entityLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relationshipType: 'target', entityType: 'agent_governance_policy' }),
        expect.objectContaining({ relationshipType: 'evidence', entityType: 'customers', entityId: '123' }),
        expect.objectContaining({ relationshipType: 'approval_subject', entityType: 'auth:user' }),
        expect.objectContaining({ relationshipType: 'exception', entityType: 'agent_governance:exception' }),
      ]),
    )
    expect(entityLinks.length).toBe(5)
    expect(whyLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reasonType: 'policy' }),
        expect.objectContaining({ reasonType: 'human_override' }),
      ]),
    )
  })

  test('checksum changes when relevant event content changes', () => {
    const baseEvent = createEvent()
    const baseLinks = buildProjectedEntityLinks(baseEvent)
    const baseWhy = buildProjectedWhyLinks(baseEvent)
    const checksumA = buildPrecedentChecksum(baseEvent, baseLinks, baseWhy)

    const changedEvent = createEvent({ writeSet: { operation: 'update', field: 'description' } })
    const changedLinks = buildProjectedEntityLinks(changedEvent)
    const changedWhy = buildProjectedWhyLinks(changedEvent)
    const checksumB = buildPrecedentChecksum(changedEvent, changedLinks, changedWhy)

    expect(checksumA).not.toBe(checksumB)
  })

  test('skips projection when checksum is unchanged', async () => {
    const em = createFakeEm()
    const event = createEvent()
    const checksum = buildPrecedentChecksum(event, buildProjectedEntityLinks(event), buildProjectedWhyLinks(event))

    mockedFindOneWithDecryption
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({
        id: 'index-1',
        decisionEventId: event.id,
        checksum,
      } as unknown as never)

    const projector = createDecisionProjectorService({ em })
    const result = await projector.projectDecisionEvent({
      eventId: event.id,
      tenantId: event.tenantId,
      organizationId: event.organizationId,
    })

    expect(result.projected).toBe(false)
    expect(result.skipped).toBe(true)
    expect((em.nativeDelete as jest.Mock).mock.calls.length).toBe(0)
    expect((em.flush as jest.Mock).mock.calls.length).toBe(0)
  })

  test('reprojects and updates index when checksum changed', async () => {
    const em = createFakeEm()
    const event = createEvent()

    mockedFindOneWithDecryption
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({
        id: 'index-1',
        decisionEventId: event.id,
        checksum: 'old-checksum',
        signature: event.signature,
        summary: null,
        score: 0,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      } as unknown as never)

    const projector = createDecisionProjectorService({ em })
    const result = await projector.projectDecisionEvent({
      eventId: event.id,
      tenantId: event.tenantId,
      organizationId: event.organizationId,
    })

    expect(result.projected).toBe(true)
    expect(result.skipped).toBe(false)
    expect((em.nativeDelete as jest.Mock).mock.calls.length).toBe(2)
    expect((em.persist as jest.Mock).mock.calls.length).toBeGreaterThan(1)
    expect((em.flush as jest.Mock).mock.calls.length).toBe(1)
  })
})
