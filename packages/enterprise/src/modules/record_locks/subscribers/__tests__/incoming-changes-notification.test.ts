import handle from '../incoming-changes-notification'

const mockCreateNotification = jest.fn()

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ create: mockCreateNotification }),
}))

jest.mock('../../lib/notificationsAvailability', () => ({
  isNotificationsModuleAvailable: () => Promise.resolve(true),
}))

test('rechecks each distinct recipient before persisting queued field changes', async () => {
  const canReadTarget = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const payload = {
    resourceKind: 'customers.person',
    resourceId: 'person-id',
    tenantId: 'tenant-id',
    organizationId: 'organization-id',
    recipientUserIds: ['reader-revoked', 'reader-current', 'reader-revoked'],
    changedFields: 'Display Name',
    changedRowsJson: JSON.stringify([{ field: 'displayName', from: 'Previous', to: 'Current' }]),
  }

  await handle(payload, {
    resolve: <Value>() => ({ canReadTarget }) as Value,
  })

  const scope = {
    resourceKind: payload.resourceKind, resourceId: payload.resourceId,
    tenantId: payload.tenantId, organizationId: payload.organizationId,
  }
  expect(canReadTarget.mock.calls).toEqual([
    [{ ...scope, userId: 'reader-revoked' }],
    [{ ...scope, userId: 'reader-current' }],
  ])
  expect(mockCreateNotification).toHaveBeenCalledTimes(1)
  expect(mockCreateNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      recipientUserId: 'reader-current',
      bodyVariables: expect.objectContaining({ changedRowsJson: payload.changedRowsJson }),
    }),
    { tenantId: payload.tenantId, organizationId: payload.organizationId },
  )
})
