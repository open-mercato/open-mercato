/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'

const mockNotifyProjectWork = jest.fn()
const mockResolveRecipients = jest.fn()
const mockLoadAssigners = jest.fn()

jest.mock('../../time-tracking/workRecipients', () => ({
  notifyProjectWork: (...args: unknown[]) => mockNotifyProjectWork(...args),
  resolveProjectWorkRecipients: (...args: unknown[]) => mockResolveRecipients(...args),
  loadActiveAssignerUserIds: (...args: unknown[]) => mockLoadAssigners(...args),
}))

jest.mock('../../time-tracking/projectAssignment', () => ({
  resolveAssignmentGraceDaysFromContainer: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: { findOne: Function }, cls: unknown, where: unknown) => em.findOne(cls, where)),
}))

import { clearSupportTicketUnnotified, notifySupportTicket } from '../notifications'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

type TicketRow = {
  id: string
  taskId: string
  supportReference: string
  categoryValue: string
  categorySnapshot: { value: string; label: string }
  customerSnapshot: Record<string, unknown>
  customerRequestSnapshot: { subject: string; body: string }
  unnotifiedAt: Date | null
  updatedAt: Date
  deletedAt: Date | null
}

function makeWorld(unnotifiedAt: Date | null) {
  const ticket: TicketRow = {
    id: 'ticket-1',
    taskId: 'task-1',
    supportReference: 'SUP-1',
    categoryValue: 'billing',
    categorySnapshot: { value: 'billing', label: 'Billing' },
    customerSnapshot: { displayName: 'Acme' },
    customerRequestSnapshot: { subject: 'Help', body: 'Please' },
    unnotifiedAt,
    updatedAt: new Date(0),
    deletedAt: null,
  }
  const task = { id: 'task-1', ...SCOPE, timeProjectId: 'project-1', assigneeStaffMemberId: null, title: 'Help', source: 'portal', deletedAt: null }
  const flush = jest.fn(async () => undefined)
  const em: Record<string, unknown> = {
    flush,
    findOne: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => {
      if (cls.name === 'StaffTimeTask') return task
      if (cls.name === 'StaffTimeProject') return { id: 'project-1', name: 'Support' }
      if (cls.name === 'StaffSupportTicket') {
        if (where.unnotifiedAt && ticket.unnotifiedAt === null) return null
        return ticket
      }
      return null
    }),
  }
  em.fork = () => em
  const container = { resolve: <T,>(name: string) => (name === 'em' ? em : null) as T }
  return { ticket, flush, em: em as unknown as EntityManager, container }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockLoadAssigners.mockResolvedValue([])
  mockResolveRecipients.mockResolvedValue({ step: 4, userIds: [] })
})

describe('notifySupportTicket', () => {
  it('sets unnotified_at when the chain reached nobody', async () => {
    mockNotifyProjectWork.mockResolvedValue({ step: 4, notifiedCount: 0 })
    const { ticket, flush, container } = makeWorld(null)

    await notifySupportTicket(container, { taskId: 'task-1', ...SCOPE, kind: 'created' })

    expect(ticket.unnotifiedAt).toBeInstanceOf(Date)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('keeps the earliest unnotified_at on a second miss', async () => {
    mockNotifyProjectWork.mockResolvedValue({ step: 4, notifiedCount: 0 })
    const earliest = new Date('2026-10-01T00:00:00.000Z')
    const { ticket, flush, container } = makeWorld(earliest)

    await notifySupportTicket(container, { taskId: 'task-1', ...SCOPE, kind: 'customer_replied' })

    expect(ticket.unnotifiedAt).toBe(earliest)
    expect(flush).not.toHaveBeenCalled()
  })

  it('clears unnotified_at once a notification reaches someone', async () => {
    mockNotifyProjectWork.mockResolvedValue({ step: 2, notifiedCount: 1 })
    const { ticket, flush, container } = makeWorld(new Date('2026-10-01T00:00:00.000Z'))

    await notifySupportTicket(container, { taskId: 'task-1', ...SCOPE, kind: 'created' })

    expect(ticket.unnotifiedAt).toBeNull()
    expect(flush).toHaveBeenCalledTimes(1)
  })
})

describe('clearSupportTicketUnnotified', () => {
  it('clears the flag on an assigned ticket', async () => {
    const { ticket, em } = makeWorld(new Date('2026-10-01T00:00:00.000Z'))
    await expect(clearSupportTicketUnnotified(em, { taskId: 'task-1', ...SCOPE })).resolves.toBe(true)
    expect(ticket.unnotifiedAt).toBeNull()
  })

  it('is a no-op when nothing is flagged', async () => {
    const { em, flush } = makeWorld(null)
    await expect(clearSupportTicketUnnotified(em, { taskId: 'task-1', ...SCOPE })).resolves.toBe(false)
    expect(flush).not.toHaveBeenCalled()
  })
})
