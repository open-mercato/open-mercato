/**
 * Regression coverage for the org-scoping gap found during the 2026-07-01 FCM
 * e2e run (see `.ai/specs/2026-07-01-push-delivery-e2e-findings.md`, Finding 1).
 *
 * The existing `push-delivery-strategy.test.ts` mocks `em.find` to return devices
 * regardless of the query, so it cannot observe the organization filter. These
 * tests use a **filter-aware** `em.find` that honours `where.organizationId`,
 * which is exactly what the real DB does — and what makes the mismatch visible.
 *
 * The strategy loads recipient devices scoped to `notification.organizationId`.
 * Devices register org-scoped (`devices` API: `scope.selectedId ?? auth.orgId`),
 * but notifications created via `POST /api/notifications` are ALWAYS tenant-level
 * (`resolveRequestContext` never sets `selectedOrganizationId`), so an org-scoped
 * device is never matched and no push is ever enqueued.
 */
import { getNotificationType } from '@open-mercato/core/modules/notifications/lib/notification-type-registry'
import { enqueuePushDelivery } from '../queue'
import { mobilePushDeliveryStrategy } from '../push-delivery-strategy'

jest.mock('@open-mercato/core/modules/notifications/lib/notification-type-registry', () => ({
  getNotificationType: jest.fn(),
}))
jest.mock('../queue', () => ({
  enqueuePushDelivery: jest.fn(async () => 'job-id'),
  PUSH_DELIVERIES_QUEUE: 'push-deliveries',
}))

const getTypeMock = getNotificationType as jest.MockedFunction<typeof getNotificationType>
const enqueueMock = enqueuePushDelivery as jest.MockedFunction<typeof enqueuePushDelivery>

const TENANT = '00000000-0000-0000-0000-000000000001'
const ORG = '00000000-0000-0000-0000-0000000000a1'
const deviceRef = { __entity: 'UserDevice' }
const channelRef = { __entity: 'CommunicationChannel' }

type DeviceRow = { id: string; pushToken: string; pushProvider: string; organizationId: string | null }

/**
 * Build a ctx whose `em.find` honours the `organizationId` in the query — i.e. a
 * device is only returned when the query's org equals the device's org (the real
 * DB semantics). `channels` are tenant-wide (no org filter), matching the strategy.
 */
function makeCtx(opts: { notificationOrg: string | null; device: DeviceRow }) {
  // Minimal kysely stub for the fan-out INSERT; `captured.insertRows` is null until the strategy
  // actually reaches the insert (it returns early when the org-filtered device query is empty).
  const captured: { insertRows: Array<Record<string, unknown>> | null } = { insertRows: null }
  const insertBuilder: Record<string, unknown> = {
    values: (rows: Array<Record<string, unknown>>) => {
      captured.insertRows = rows
      return insertBuilder
    },
    onConflict: (cb: (oc: unknown) => unknown) => {
      const oc: Record<string, unknown> = { columns: () => oc, where: () => oc, doNothing: () => oc }
      cb(oc)
      return insertBuilder
    },
    returning: () => insertBuilder,
    execute: async () => (captured.insertRows ?? []).map((_, i) => ({ id: `del-${i + 1}` })),
  }
  const db = {
    insertInto: () => insertBuilder,
    updateTable: () => ({ set: () => ({ where: () => ({ execute: async () => undefined }) }) }),
  }
  const em = {
    getKysely: jest.fn(() => db),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === channelRef) return [{ providerKey: 'fcm', userId: 'user-1', organizationId: ORG }]
      if (entity === deviceRef) {
        const wantOrg = (where?.organizationId ?? null) as string | null
        return opts.device.organizationId === wantOrg ? [opts.device] : []
      }
      return []
    }),
  }
  const resolve = (<T,>(name: string): T => {
    const map: Record<string, unknown> = { em, UserDevice: deviceRef, CommunicationChannel: channelRef }
    return map[name] as T
  })
  const notification = {
    id: 'notif-1',
    type: 'messages.new',
    recipientUserId: 'user-1',
    tenantId: TENANT,
    organizationId: opts.notificationOrg,
    linkHref: '/inbox',
  }
  const ctx = { notification, title: 'New message', body: 'hi', resolve } as never
  return { ctx, em, captured }
}

beforeEach(() => {
  getTypeMock.mockReset()
  enqueueMock.mockClear()
  getTypeMock.mockReturnValue({ type: 'messages.new' } as never)
})

describe('push delivery org scoping', () => {
  const device: DeviceRow = { id: 'dev-1', pushToken: 'tok', pushProvider: 'fcm', organizationId: ORG }

  it('delivers when the notification org matches the org-scoped device', async () => {
    const { ctx, captured } = makeCtx({ notificationOrg: ORG, device })
    await mobilePushDeliveryStrategy.deliver(ctx)
    expect(captured.insertRows).toHaveLength(1)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  // Finding 1 (fix): the strategy delivers strictly by the notification's own org —
  // a tenant-level (org=null) notification only reaches tenant-level devices, and does
  // NOT fan out to a device the user registered under an organization. The bug was NOT
  // fixed here (the strategy's org scoping is correct); it was fixed upstream at
  // `resolveNotificationContext`, which now stamps the creator's org onto the
  // notification so it matches the org-scoped device. See
  // `notifications/lib/__tests__/routeHelpers-org-scoping.test.ts`.
  it('does not fan a tenant-level (org=null) notification out to an org-scoped device', async () => {
    const { ctx, captured } = makeCtx({ notificationOrg: null, device })
    await mobilePushDeliveryStrategy.deliver(ctx)
    expect(captured.insertRows).toBeNull()
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
