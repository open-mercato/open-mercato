import type { EntityManager } from '@mikro-orm/postgresql'
import { ActionLog, AccessLog } from '../../data/entities'
import {
  AuditEvidenceExportService,
  createSignedAuditEvidenceBundle,
  resolveEvidenceCorrelationId,
  verifyAuditEvidenceBundle,
  type AuditEvidenceBundle,
  type AuditEvidenceRecordInput,
} from '../evidenceExportService'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const SIGNING_KEY = 'audit-evidence-test-key-32-bytes-minimum'
const OTHER_KEY = 'different-audit-evidence-key-32-bytes'
const SCOPE = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

function records(): AuditEvidenceRecordInput[] {
  return [
    {
      source: 'audit.action',
      type: 'customers.create',
      id: 'action-1',
      correlationId: 'request-1',
      occurredAt: '2026-08-21T10:00:00.000Z',
      ...SCOPE,
      actorId: 'user-1',
      payload: { resourceId: 'customer-1' },
    },
    {
      source: 'audit.access',
      type: 'read',
      id: 'access-1',
      correlationId: 'request-1',
      occurredAt: '2026-08-21T10:00:01.000Z',
      ...SCOPE,
      actorId: 'user-1',
      payload: { resourceId: 'customer-1' },
    },
    {
      source: 'external.record',
      type: 'ok',
      id: 'external-1',
      correlationId: 'external-1',
      occurredAt: '2026-08-21T10:00:02.000Z',
      ...SCOPE,
      payload: { integration: 'example' },
    },
  ]
}

function bundle(): AuditEvidenceBundle {
  return createSignedAuditEvidenceBundle(
    records(),
    SCOPE,
    SIGNING_KEY,
    new Date('2026-08-21T12:00:00.000Z'),
  )
}

function cloneBundle(value: AuditEvidenceBundle): AuditEvidenceBundle {
  return JSON.parse(JSON.stringify(value)) as AuditEvidenceBundle
}

describe('signed audit evidence', () => {
  it('verifies an unchanged bundle and rejects a different key', () => {
    expect(verifyAuditEvidenceBundle(bundle(), SIGNING_KEY)).toEqual({ valid: true, errors: [] })
    expect(verifyAuditEvidenceBundle(bundle(), OTHER_KEY).valid).toBe(false)
  })

  it('detects modified historical payloads', () => {
    const modified = cloneBundle(bundle())
    modified.records[0].payload = { resourceId: 'changed' }

    const result = verifyAuditEvidenceBundle(modified, SIGNING_KEY)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Invalid hash at record action-1')
    expect(result.errors).toContain('Invalid bundle signature')
  })

  it('detects deleted and reordered records', () => {
    const deleted = cloneBundle(bundle())
    deleted.records.splice(1, 1)
    expect(verifyAuditEvidenceBundle(deleted, SIGNING_KEY).valid).toBe(false)

    const reordered = cloneBundle(bundle())
    ;[reordered.records[0], reordered.records[1]] = [reordered.records[1], reordered.records[0]]
    expect(verifyAuditEvidenceBundle(reordered, SIGNING_KEY).valid).toBe(false)
  })

  it('rejects signing keys shorter than 32 bytes', () => {
    expect(() => createSignedAuditEvidenceBundle(records(), SCOPE, 'short')).toThrow(
      'Audit evidence signing key must contain at least 32 bytes',
    )
  })
})

describe('audit evidence collection', () => {
  const mockedFind = jest.mocked(findWithDecryption)

  beforeEach(() => {
    mockedFind.mockReset()
  })

  it('collects action and access records with strict scope and request correlation', async () => {
    const action = Object.assign(new ActionLog(), {
      id: 'action-1',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      actorUserId: 'user-1',
      commandId: 'customers.create',
      contextJson: { correlationId: 'request-1' },
      createdAt: new Date('2026-08-21T10:00:00.000Z'),
      updatedAt: new Date('2026-08-21T10:00:00.000Z'),
    })
    const access = Object.assign(new AccessLog(), {
      id: 'access-1',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      actorUserId: 'user-1',
      resourceKind: 'customers.customer',
      resourceId: 'customer-1',
      accessType: 'read',
      contextJson: { requestId: 'request-1' },
      createdAt: new Date('2026-08-21T10:00:01.000Z'),
    })
    const queries: Array<Record<string, unknown>> = []
    mockedFind.mockImplementation(async (_em, entity, where) => {
      queries.push(where as Record<string, unknown>)
      return (entity === ActionLog ? [action] : [access]) as never
    })
    const fakeEm = { fork: () => fakeEm } as unknown as EntityManager
    const service = new AuditEvidenceExportService(fakeEm)

    const result = await service.export(SCOPE, SIGNING_KEY)

    expect(queries).toHaveLength(2)
    for (const query of queries) {
      expect(query).toMatchObject({ ...SCOPE, deletedAt: null })
    }
    expect(result.records.map((record) => record.correlationId)).toEqual(['request-1', 'request-1'])
    expect(result.sources).toEqual({ 'audit.action': 1, 'audit.access': 1 })
  })

  it('resolves correlation fields in priority order and falls back to record id', () => {
    expect(resolveEvidenceCorrelationId({ requestId: 'request-1' }, 'fallback')).toBe('request-1')
    expect(resolveEvidenceCorrelationId({}, 'fallback')).toBe('fallback')
  })

  it('refuses to create a partial bundle when a source exceeds the limit', async () => {
    const action = Object.assign(new ActionLog(), {
      id: 'action-1',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      commandId: 'customers.create',
      createdAt: new Date('2026-08-21T10:00:00.000Z'),
      updatedAt: new Date('2026-08-21T10:00:00.000Z'),
    })
    mockedFind.mockResolvedValueOnce([action, Object.assign(new ActionLog(), { ...action, id: 'action-2' })] as never)
    const fakeEm = { fork: () => fakeEm } as unknown as EntityManager
    const service = new AuditEvidenceExportService(fakeEm)

    await expect(service.export({ ...SCOPE, limitPerSource: 1 }, SIGNING_KEY)).rejects.toThrow(
      'Audit evidence source audit.action exceeds the 1 record limit',
    )
  })

  it('rejects records returned outside the requested scope', async () => {
    mockedFind.mockResolvedValue([] as never)
    const fakeEm = { fork: () => fakeEm } as unknown as EntityManager
    const service = new AuditEvidenceExportService(fakeEm)
    const contributor = {
      id: 'invalid-scope',
      async collect(): Promise<AuditEvidenceRecordInput[]> {
        return [{
          source: 'external.record',
          type: 'test',
          id: 'outside-1',
          correlationId: 'outside-1',
          occurredAt: new Date(),
          tenantId: '33333333-3333-4333-8333-333333333333',
          organizationId: SCOPE.organizationId,
          payload: {},
        }]
      },
    }

    await expect(service.export(SCOPE, SIGNING_KEY, [contributor])).rejects.toThrow(
      'Audit evidence contributor returned out-of-scope record outside-1',
    )
  })
})
