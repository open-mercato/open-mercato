import { toNotificationDto } from '../notificationMapper'
import type { Notification } from '../../data/entities'

function buildNotification(overrides: Partial<Notification>): Notification {
  return {
    id: 'n-1',
    type: 'wms.inventory.reservation_shortfall',
    title: 'Shortfall',
    severity: 'warning',
    status: 'actioned',
    sourceEntityId: 'o-1',
    linkHref: '/backend/sales/orders/o-1',
    createdAt: new Date('2026-09-25T00:00:00.000Z'),
    ...overrides,
  } as Notification
}

describe('toNotificationDto', () => {
  it('exposes each action href with the source entity id resolved', () => {
    const dto = toNotificationDto(buildNotification({
      actionData: {
        actions: [
          { id: 'view-order', label: 'View order', href: '/backend/sales/orders/{sourceEntityId}' },
          { id: 'view-inventory', label: 'View inventory', href: '/backend/wms/inventory' },
          { id: 'approve', label: 'Approve', commandId: 'wms.approve' },
        ],
      },
    }))

    expect(dto.actions.map((action) => [action.id, action.href])).toEqual([
      ['view-order', '/backend/sales/orders/o-1'],
      ['view-inventory', '/backend/wms/inventory'],
      ['approve', undefined],
    ])
  })
})
