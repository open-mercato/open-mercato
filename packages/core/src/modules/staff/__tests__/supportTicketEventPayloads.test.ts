import { z } from 'zod'
import { eventsConfig } from '../events'
import {
  staffSupportTicketEventPayloadSchemas,
  type StaffSupportTicketEventId,
} from '../events.payloads'

const SUPPORT_TICKET_PREFIX = 'staff.support_ticket.'

const declaredSupportTicketIds = eventsConfig.events
  .map((event) => event.id)
  .filter((id) => id.startsWith(SUPPORT_TICKET_PREFIX))

const schemaIds = Object.keys(staffSupportTicketEventPayloadSchemas) as StaffSupportTicketEventId[]

const FORBIDDEN_BROADCAST_FIELDS = ['customerId', 'customerName', 'supportReference', 'body', 'description']

const scope = { tenantId: 'tenant', organizationId: 'org' }

describe('staff.support_ticket.* webhook payload contracts', () => {
  it('covers every declared support ticket event id', () => {
    expect([...schemaIds].sort()).toEqual([...declaredSupportTicketIds].sort())
  })

  it.each(schemaIds)('requires tenantId on %s', (eventId) => {
    expect(staffSupportTicketEventPayloadSchemas[eventId].safeParse({ organizationId: 'org' }).success).toBe(false)
  })

  it('declares no customer identity or free text on the client-broadcast event', () => {
    const broadcastIds = eventsConfig.events
      .filter((event) => event.id.startsWith(SUPPORT_TICKET_PREFIX) && 'clientBroadcast' in event && event.clientBroadcast)
      .map((event) => event.id as StaffSupportTicketEventId)
    expect(broadcastIds).toEqual(['staff.support_ticket.activity_recorded'])
    for (const eventId of broadcastIds) {
      const schema = staffSupportTicketEventPayloadSchemas[eventId] as unknown as z.ZodObject<z.ZodRawShape>
      for (const field of FORBIDDEN_BROADCAST_FIELDS) expect(Object.keys(schema.shape)).not.toContain(field)
    }
  })

  it('accepts the payloads the emitters publish', () => {
    expect(
      staffSupportTicketEventPayloadSchemas['staff.support_ticket.created'].safeParse({
        ...scope,
        id: 'ticket',
        taskId: 'task',
        projectId: 'project',
        customerId: 'customer',
        supportReference: 'SUP-1',
        categoryValue: 'bug',
      }).success,
    ).toBe(true)
    expect(
      staffSupportTicketEventPayloadSchemas['staff.support_ticket.customer_replied'].safeParse({
        ...scope,
        id: 'ticket',
        taskId: 'task',
        projectId: 'project',
        commentId: 'comment',
        supportReference: 'SUP-1',
      }).success,
    ).toBe(true)
    expect(
      staffSupportTicketEventPayloadSchemas['staff.support_ticket.activity_recorded'].safeParse({
        ...scope,
        id: 'ticket',
        taskId: 'task',
        projectId: 'project',
        kind: 'portal_status',
      }).success,
    ).toBe(true)
    for (const kind of ['attachment_added', 'attachment_removed']) {
      expect(
        staffSupportTicketEventPayloadSchemas['staff.support_ticket.activity_recorded'].safeParse({
          ...scope,
          id: 'ticket',
          taskId: 'task',
          projectId: 'project',
          kind,
          attachmentId: 'attachment',
        }).success,
      ).toBe(true)
    }
    expect(
      staffSupportTicketEventPayloadSchemas['staff.support_ticket.activity_recorded'].safeParse({
        ...scope,
        id: 'ticket',
        taskId: 'task',
        projectId: 'project',
        kind: 'attachment_added',
        attachmentId: 42,
      }).success,
    ).toBe(false)
    expect(
      staffSupportTicketEventPayloadSchemas['staff.support_ticket.portal_updated'].safeParse({
        ...scope,
        id: 'task',
        ticketId: 'task',
        supportReference: 'SUP-1',
        portalStatus: 'in_progress',
        kind: 'reply',
        recipientUserIds: ['customer-user'],
      }).success,
    ).toBe(true)
  })

  it('rejects a portal update with no pinned recipients', () => {
    expect(
      staffSupportTicketEventPayloadSchemas['staff.support_ticket.portal_updated'].safeParse({
        ...scope,
        id: 'task',
        ticketId: 'task',
        supportReference: 'SUP-1',
        portalStatus: 'resolved',
        kind: 'status',
        recipientUserIds: [],
      }).success,
    ).toBe(false)
  })
})
