/** @jest-environment node */
const mockClearUnnotified = jest.fn()

jest.mock('../../lib/support/notifications', () => ({
  clearSupportTicketUnnotified: (...args: unknown[]) => mockClearUnnotified(...args),
}))

import handleAssigneeNotification, { planAssigneeNotification, metadata as assigneeMetadata } from '../time-task-assignee-notification'
import handleUnnotifiedClear, { metadata as unnotifiedMetadata } from '../support-ticket-unnotified-clear'
import { metadata as statusColumnMetadata } from '../support-portal-status-column-updated'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('planAssigneeNotification', () => {
  it('notifies the project chain on a release', () => {
    expect(planAssigneeNotification({ changeKind: 'release', assigneeStaffMemberId: null })).toBe('released')
  })

  it('treats a manual unassignment as a release and a manual assignment as an assignment', () => {
    expect(planAssigneeNotification({ changeKind: 'manual', assigneeStaffMemberId: null })).toBe('released')
    expect(planAssigneeNotification({ changeKind: 'manual', assigneeStaffMemberId: 'member-1' })).toBe('assigned')
  })

  it('stays silent for a claim, a portal default assignee and an unknown kind', () => {
    expect(planAssigneeNotification({ changeKind: 'claim', assigneeStaffMemberId: 'member-1' })).toBeNull()
    expect(planAssigneeNotification({ changeKind: 'default', assigneeStaffMemberId: 'member-1' })).toBeNull()
    expect(planAssigneeNotification({ changeKind: null, assigneeStaffMemberId: 'member-1' })).toBeNull()
    expect(planAssigneeNotification({})).toBeNull()
  })
})

describe('persistent support subscribers retry on failure', () => {
  const failingContainer = {
    resolve: <T,>(): T => {
      throw new Error('[internal] em unavailable')
    },
  }

  it('declares the queue-backed subscribers persistent', () => {
    expect(assigneeMetadata.persistent).toBe(true)
    expect(unnotifiedMetadata.persistent).toBe(true)
    expect(statusColumnMetadata.persistent).toBe(true)
  })

  it('rethrows from the assignee notification so the queue retries', async () => {
    await expect(
      handleAssigneeNotification(
        { id: 'task-1', tenantId: 'tenant-1', organizationId: 'org-1', changeKind: 'release' },
        failingContainer,
      ),
    ).rejects.toThrow('em unavailable')
  })

  it('rethrows from the unnotified clear so the queue retries', async () => {
    const em = { fork: () => em }
    mockClearUnnotified.mockRejectedValue(new Error('[internal] db down'))
    await expect(
      handleUnnotifiedClear(
        { id: 'task-1', tenantId: 'tenant-1', organizationId: 'org-1', assigneeStaffMemberId: 'member-1' },
        { resolve: <T,>() => em as T },
      ),
    ).rejects.toThrow('db down')
  })

  it('does nothing for an unassignment', async () => {
    await handleUnnotifiedClear(
      { id: 'task-1', tenantId: 'tenant-1', organizationId: 'org-1', assigneeStaffMemberId: null },
      failingContainer,
    )
    expect(mockClearUnnotified).not.toHaveBeenCalled()
  })
})
