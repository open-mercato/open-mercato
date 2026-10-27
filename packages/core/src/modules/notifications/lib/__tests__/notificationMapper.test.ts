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

describe('toNotificationDto with stored unsafe hrefs', () => {
  it('does not expose a stored linkHref that resolves to another origin', () => {
    const dto = toNotificationDto(buildNotification({ linkHref: '/\\evil.example/phish' }))
    expect(dto.linkHref).toBeNull()
  })

  it('does not expose a stored action href that resolves to another origin', () => {
    const dto = toNotificationDto(buildNotification({
      actionData: {
        actions: [
          { id: 'bad', label: 'Bad', href: '/\t/evil.example' },
          { id: 'good', label: 'Good', href: '/backend/sales/orders/{sourceEntityId}' },
        ],
      },
    }))

    expect(dto.actions.map((action) => [action.id, action.href])).toEqual([
      ['bad', undefined],
      ['good', '/backend/sales/orders/o-1'],
    ])
  })

  it('keeps a safe linkHref unchanged', () => {
    expect(toNotificationDto(buildNotification({})).linkHref).toBe('/backend/sales/orders/o-1')
  })

  it('keeps a missing linkHref null', () => {
    expect(toNotificationDto(buildNotification({ linkHref: null })).linkHref).toBeNull()
  })
})
