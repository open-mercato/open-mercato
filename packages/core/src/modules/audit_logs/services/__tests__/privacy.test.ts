import type { AccessLogService } from '../accessLogService'
import { AccessLog } from '../../data/entities'
import { AccessLogsPrivacyHandler } from '../../privacy'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const subject = {
  kind: 'auth:user',
  id: '33333333-3333-4333-8333-333333333333',
}

function accessLog(id: string, createdAt: string): AccessLog {
  return Object.assign(new AccessLog(), {
    id,
    ...scope,
    actorUserId: subject.id,
    resourceKind: 'customers.person',
    resourceId: '44444444-4444-4444-8444-444444444444',
    accessType: 'read:item',
    fieldsJson: ['id', 'primaryEmail'],
    contextJson: { sourceIp: '203.0.113.10', operation: 'read' },
    createdAt: new Date(createdAt),
  })
}

describe('AccessLogsPrivacyHandler', () => {
  it('discovers access records only in the subject scope', async () => {
    const list = jest.fn(async () => ({ items: [], total: 7, page: 1, pageSize: 1, totalPages: 7 }))
    const handler = new AccessLogsPrivacyHandler({ list } as unknown as AccessLogService)

    const result = await handler.discoverSubject({
      scope,
      subject,
      actorId: '55555555-5555-4555-8555-555555555555',
      dryRun: true,
    })

    expect(result).toEqual({ found: true, recordCount: 7 })
    expect(list).toHaveBeenCalledWith({ ...scope, actorUserId: subject.id, page: 1, pageSize: 1 })
  })

  it('exports all actor access-log pages without exposing a mutation handler', async () => {
    const first = accessLog('66666666-6666-4666-8666-666666666666', '2026-08-24T10:00:00.000Z')
    const second = accessLog('77777777-7777-4777-8777-777777777777', '2026-08-24T11:00:00.000Z')
    const list = jest
      .fn()
      .mockResolvedValueOnce({ items: [first], total: 2, page: 1, pageSize: 200, totalPages: 2 })
      .mockResolvedValueOnce({ items: [second], total: 2, page: 2, pageSize: 200, totalPages: 2 })
    const handler = new AccessLogsPrivacyHandler({ list } as unknown as AccessLogService)

    const result = await handler.exportSubject({
      scope,
      subject,
      actorId: '55555555-5555-4555-8555-555555555555',
      dryRun: true,
    })

    expect(result.recordCount).toBe(2)
    expect(result.data).toEqual([
      expect.objectContaining({
        id: first.id,
        actorUserId: subject.id,
        context: first.contextJson,
        createdAt: '2026-08-24T10:00:00.000Z',
      }),
      expect.objectContaining({ id: second.id, createdAt: '2026-08-24T11:00:00.000Z' }),
    ])
    expect(list).toHaveBeenNthCalledWith(2, { ...scope, actorUserId: subject.id, page: 2, pageSize: 200 })
    expect(handler.eraseSubject).toBeUndefined()
    expect(handler.anonymizeSubject).toBeUndefined()
  })
})
