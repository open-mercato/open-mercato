import { transformDeviceListItem, deviceListItemSchema } from '../api/deviceList'
import { serializeDeviceDetail, deviceDetailItemSchema } from '../api/deviceSerialization'
import type { UserDevice } from '../data/entities'

const rawListRow = {
  id: '11111111-1111-4111-8111-111111111111',
  tenant_id: '22222222-2222-4222-8222-222222222222',
  organization_id: '33333333-3333-4333-8333-333333333333',
  user_id: '44444444-4444-4444-8444-444444444444',
  device_id: 'device-abc',
  platform: 'ios',
  client_app_version: '1.2.3',
  os_version: 'iOS 18.1',
  locale: 'en',
  push_provider: 'apns',
  push_token_updated_at: '2026-08-20T10:00:00.000Z',
  last_seen_at: '2026-08-21T10:00:00.000Z',
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-22T10:00:00.000Z',
}

const CAMEL_LIST_KEYS = [
  'tenantId',
  'organizationId',
  'userId',
  'deviceId',
  'clientAppVersion',
  'osVersion',
  'pushProvider',
  'pushTokenUpdatedAt',
  'lastSeenAt',
  'createdAt',
  'updatedAt',
] as const

describe('devices list response casing', () => {
  it('exposes every column in camelCase, matching the platform convention', () => {
    const item = transformDeviceListItem(rawListRow) as Record<string, unknown>
    for (const key of CAMEL_LIST_KEYS) {
      expect(item[key]).toBeDefined()
    }
    expect(item.userId).toBe(rawListRow.user_id)
    expect(item.deviceId).toBe(rawListRow.device_id)
    expect(item.clientAppVersion).toBe(rawListRow.client_app_version)
    expect(item.pushProvider).toBe(rawListRow.push_provider)
    expect(item.lastSeenAt).toBe(rawListRow.last_seen_at)
  })

  it('keeps the deprecated snake_case aliases in sync with their camelCase source', () => {
    const item = transformDeviceListItem(rawListRow) as Record<string, unknown>
    expect(item.user_id).toBe(item.userId)
    expect(item.device_id).toBe(item.deviceId)
    expect(item.client_app_version).toBe(item.clientAppVersion)
    expect(item.os_version).toBe(item.osVersion)
    expect(item.push_provider).toBe(item.pushProvider)
    expect(item.push_token_updated_at).toBe(item.pushTokenUpdatedAt)
    expect(item.last_seen_at).toBe(item.lastSeenAt)
    expect(item.created_at).toBe(item.createdAt)
    expect(item.updated_at).toBe(item.updatedAt)
  })

  it('normalizes Date columns to ISO strings and tolerates camelCase input', () => {
    const item = transformDeviceListItem({
      ...rawListRow,
      last_seen_at: new Date('2026-08-21T10:00:00.000Z'),
      updated_at: undefined,
      updatedAt: new Date('2026-08-22T10:00:00.000Z'),
    }) as Record<string, unknown>
    expect(item.lastSeenAt).toBe('2026-08-21T10:00:00.000Z')
    expect(item.updatedAt).toBe('2026-08-22T10:00:00.000Z')
  })

  it('preserves keys beyond the declared projection', () => {
    const item = transformDeviceListItem({ ...rawListRow, cf_department: 'field-ops' }) as Record<string, unknown>
    expect(item.cf_department).toBe('field-ops')
  })

  it('never exposes the push token', () => {
    const item = transformDeviceListItem({ ...rawListRow, push_token: 'secret-token' }) as Record<string, unknown>
    expect(item.pushToken).toBeUndefined()
  })

  it('satisfies the documented list item schema', () => {
    expect(() => deviceListItemSchema.parse(transformDeviceListItem(rawListRow))).not.toThrow()
  })
})

describe('devices detail response casing', () => {
  const device = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '44444444-4444-4444-8444-444444444444',
    deviceId: 'device-abc',
    platform: 'ios',
    clientAppVersion: '1.2.3',
    osVersion: 'iOS 18.1',
    pushProvider: 'apns',
    pushTokenUpdatedAt: new Date('2026-08-20T10:00:00.000Z'),
    lastSeenAt: new Date('2026-08-21T10:00:00.000Z'),
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-22T10:00:00.000Z'),
  } as UserDevice

  it('serializes the detail item in camelCase with ISO timestamps', () => {
    const item = serializeDeviceDetail(device)
    expect(item.deviceId).toBe('device-abc')
    expect(item.clientAppVersion).toBe('1.2.3')
    expect(item.updatedAt).toBe('2026-08-22T10:00:00.000Z')
    expect(item.lastSeenAt).toBe('2026-08-21T10:00:00.000Z')
  })

  it('keeps the deprecated snake_case aliases without inventing tenant or organization keys', () => {
    const item = serializeDeviceDetail(device)
    expect(item.device_id).toBe(item.deviceId)
    expect(item.updated_at).toBe(item.updatedAt)
    expect(item).not.toHaveProperty('tenant_id')
    expect(item).not.toHaveProperty('organization_id')
  })

  it('nulls absent optional columns instead of dropping them', () => {
    const item = serializeDeviceDetail({ ...device, clientAppVersion: null, lastSeenAt: null } as UserDevice)
    expect(item.clientAppVersion).toBeNull()
    expect(item.lastSeenAt).toBeNull()
  })

  it('satisfies the documented detail item schema', () => {
    expect(() => deviceDetailItemSchema.parse(serializeDeviceDetail(device))).not.toThrow()
  })
})
