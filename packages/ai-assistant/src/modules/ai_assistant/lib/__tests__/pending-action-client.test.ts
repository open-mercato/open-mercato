import {
  serializePendingActionForClient,
  type SerializablePendingActionRow,
  type SerializedPendingAction,
} from '../pending-action-client'

function makeRow(
  overrides: Partial<SerializablePendingActionRow> = {},
): SerializablePendingActionRow {
  const base: SerializablePendingActionRow = {
    id: 'pa_123',
    agentId: 'catalog.merchandising_assistant',
    toolName: 'catalog.update_product',
    status: 'pending',
    fieldDiff: [{ field: 'title', before: 'Old', after: 'New' }],
    records: null,
    failedRecords: null,
    sideEffectsSummary: null,
    attachmentIds: [],
    targetEntityType: 'product',
    targetRecordId: 'prod_1',
    recordVersion: 'v1',
    queueMode: 'inline',
    executionResult: null,
    createdAt: new Date('2026-04-18T10:00:00.000Z'),
    expiresAt: new Date('2026-04-18T10:15:00.000Z'),
    resolvedAt: null,
    resolvedByUserId: null,
  }
  return { ...base, ...overrides }
}

describe('serializePendingActionForClient (Step 5.7)', () => {
  it('produces the full whitelist in the documented shape', () => {
    const row = makeRow()
    const out = serializePendingActionForClient(row)

    const expected: SerializedPendingAction = {
      id: 'pa_123',
      agentId: 'catalog.merchandising_assistant',
      toolName: 'catalog.update_product',
      status: 'pending',
      fieldDiff: [{ field: 'title', before: 'Old', after: 'New' }],
      records: null,
      failedRecords: null,
      sideEffectsSummary: null,
      attachmentIds: [],
      targetEntityType: 'product',
      targetRecordId: 'prod_1',
      recordVersion: 'v1',
      queueMode: 'inline',
      executionResult: null,
      createdAt: '2026-04-18T10:00:00.000Z',
      expiresAt: '2026-04-18T10:15:00.000Z',
      resolvedAt: null,
      resolvedByUserId: null,
    }
    expect(out).toEqual(expected)
  })

  it('never exposes server-internal fields even when they exist on the row', () => {
    const row = {
      ...makeRow(),
      // Simulate the real MikroORM entity shape with internal fields present.
      normalizedInput: { secret: 'do-not-leak' },
      createdByUserId: 'user-1',
      idempotencyKey: 'idem_abc123',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    } as unknown as SerializablePendingActionRow

    const out = serializePendingActionForClient(row)

    expect(out).not.toHaveProperty('normalizedInput')
    expect(out).not.toHaveProperty('createdByUserId')
    expect(out).not.toHaveProperty('idempotencyKey')
    expect(out).not.toHaveProperty('tenantId')
    expect(out).not.toHaveProperty('organizationId')
  })

  it('keeps the exact whitelist of keys', () => {
    const row = makeRow()
    const out = serializePendingActionForClient(row)
    const keys = Object.keys(out).sort()
    expect(keys).toEqual(
      [
        'agentId',
        'attachmentIds',
        'createdAt',
        'executionResult',
        'expiresAt',
        'failedRecords',
        'fieldDiff',
        'id',
        'queueMode',
        'recordVersion',
        'records',
        'resolvedAt',
        'resolvedByUserId',
        'sideEffectsSummary',
        'status',
        'targetEntityType',
        'targetRecordId',
        'toolName',
      ].sort(),
    )
  })

  it('normalizes batch records + failedRecords and strips empty arrays', () => {
    const out = serializePendingActionForClient(
      makeRow({
        records: [
          {
            recordId: 'p_1',
            entityType: 'product',
            label: 'SKU 1',
            fieldDiff: [{ field: 'price', before: 10, after: 12 }],
            recordVersion: 'v1',
          },
        ],
        failedRecords: [],
      }),
    )
    expect(out.records).toHaveLength(1)
    expect(out.records?.[0]?.recordId).toBe('p_1')
    expect(out.failedRecords).toBeNull()
  })

  it('accepts ISO strings for Date fields (round-trip safety)', () => {
    const out = serializePendingActionForClient(
      makeRow({
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T00:10:00.000Z',
        resolvedAt: '2026-01-01T00:05:00.000Z',
      }),
    )
    expect(out.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(out.expiresAt).toBe('2026-01-01T00:10:00.000Z')
    expect(out.resolvedAt).toBe('2026-01-01T00:05:00.000Z')
  })

  it('defaults queueMode to "inline" when absent', () => {
    const out = serializePendingActionForClient(
      makeRow({ queueMode: undefined as unknown as SerializablePendingActionRow['queueMode'] }),
    )
    expect(out.queueMode).toBe('inline')
  })
})
