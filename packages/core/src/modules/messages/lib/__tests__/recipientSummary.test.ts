import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '../../../auth/data/entities'
import { MessageExternalParticipant } from '../../data/entities'
import { buildRecipientSummaries } from '../recipientSummary'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function mockData(options: {
  recipients: Array<{ messageId: string; recipientUserId: string; recipientType: string }>
  participants: Array<{ messageId: string; role: string; email: string }>
  users: Array<{ id: string; name?: string | null; email?: string | null }>
}) {
  const em = { find: jest.fn(async () => options.recipients) }
  ;(findWithDecryption as jest.Mock).mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === MessageExternalParticipant) return options.participants
    if (entity === User) return options.users
    return []
  })
  return em as never
}

describe('buildRecipientSummaries', () => {
  beforeEach(() => jest.clearAllMocks())

  it('orders internal recipients before external addresses, to before cc before bcc, and caps the labels', async () => {
    const em = mockData({
      recipients: [{ messageId: 'm1', recipientUserId: 'u1', recipientType: 'cc' }],
      participants: [
        { messageId: 'm1', role: 'bcc', email: 'hidden@example.com' },
        { messageId: 'm1', role: 'to', email: 'first@example.com' },
        { messageId: 'm1', role: 'cc', email: 'copy@example.com' },
      ],
      users: [{ id: 'u1', name: ' Anna ', email: 'anna@example.com' }],
    })
    const summaries = await buildRecipientSummaries(em, [{ id: 'm1' }], scope)
    expect(summaries.get('m1')).toEqual({ labels: ['Anna', 'first@example.com', 'copy@example.com'], total: 4 })
  })

  it('falls back to externalEmail for messages without participant rows and skips messages with nobody', async () => {
    const em = mockData({ recipients: [], participants: [], users: [] })
    const summaries = await buildRecipientSummaries(em, [
      { id: 'legacy', externalEmail: 'legacy@example.com' },
      { id: 'empty', externalEmail: null },
    ], scope)
    expect(summaries.get('legacy')).toEqual({ labels: ['legacy@example.com'], total: 1 })
    expect(summaries.has('empty')).toBe(false)
  })
})
