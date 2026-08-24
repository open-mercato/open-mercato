import { z } from 'zod'

// Shared list contract for the self-serve (`/api/devices`) and admin (`/api/devices/admin/devices`)
// list routes. push_token is a secret and is never part of the exposed field set.
export const deviceListSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    platform: z.enum(['ios', 'android', 'web']).optional(),
    userId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export const deviceListFields: string[] = [
  'id',
  'tenant_id',
  'organization_id',
  'user_id',
  'device_id',
  'platform',
  'client_app_version',
  'os_version',
  'locale',
  'push_provider',
  'push_token_updated_at',
  'last_seen_at',
  'created_at',
  'updated_at',
]

export const deviceListSortFieldMap: Record<string, string> = {
  lastSeenAt: 'last_seen_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
}

// The query engine projects the raw column names listed in `deviceListFields`. Every other module
// serializes its list items in camelCase (`sales/orders` → `orderNumber`, `warranty_claims` →
// `claimNumber`), so the list routes run this transform to expose the platform convention (#5513).
// The snake_case keys stay alongside as deprecated aliases for one minor version, per the
// deprecation protocol in BACKWARD_COMPATIBILITY.md § 7 (API Route URLs — response fields).
export function transformDeviceListItem(item: unknown): unknown {
  const record = toRecord(item)
  if (!Object.keys(record).length) return item
  const camel = {
    id: readString(record, 'id', 'id'),
    tenantId: readString(record, 'tenant_id', 'tenantId'),
    organizationId: readString(record, 'organization_id', 'organizationId'),
    userId: readString(record, 'user_id', 'userId'),
    deviceId: readString(record, 'device_id', 'deviceId'),
    platform: readString(record, 'platform', 'platform'),
    clientAppVersion: readString(record, 'client_app_version', 'clientAppVersion'),
    osVersion: readString(record, 'os_version', 'osVersion'),
    locale: readString(record, 'locale', 'locale'),
    pushProvider: readString(record, 'push_provider', 'pushProvider'),
    pushTokenUpdatedAt: toIso(record.push_token_updated_at ?? record.pushTokenUpdatedAt),
    lastSeenAt: toIso(record.last_seen_at ?? record.lastSeenAt),
    createdAt: toIso(record.created_at ?? record.createdAt),
    updatedAt: toIso(record.updated_at ?? record.updatedAt),
  }
  // Spread the raw record first so anything the projection carries beyond the declared field set
  // (custom-field keys, future columns) survives; the aliases then restate the snake_case keys with
  // the same normalized values as their camelCase counterparts.
  return { ...record, ...camel, ...toDeprecatedSnakeCaseAliases(camel) }
}

/**
 * @deprecated Snake_case device response keys are superseded by the camelCase keys and are removed in
 * the next minor release. Read `deviceId`, `userId`, `lastSeenAt`, … instead. See UPGRADE_NOTES.md.
 */
export function toDeprecatedSnakeCaseAliases(item: DeviceResponseItem): Record<string, unknown> {
  const aliases: Record<string, unknown> = {
    tenant_id: item.tenantId,
    organization_id: item.organizationId,
    user_id: item.userId,
    device_id: item.deviceId,
    client_app_version: item.clientAppVersion,
    os_version: item.osVersion,
    push_provider: item.pushProvider,
    push_token_updated_at: item.pushTokenUpdatedAt,
    last_seen_at: item.lastSeenAt,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }
  // The detail response never carried tenant/org, so an absent camelCase source must not grow a new
  // key here — only keys the caller actually supplied get an alias.
  for (const key of Object.keys(aliases)) {
    if (aliases[key] === undefined) delete aliases[key]
  }
  return aliases
}

export type DeviceResponseItem = {
  tenantId?: string | null
  organizationId?: string | null
  userId: string | null
  deviceId: string | null
  clientAppVersion: string | null
  osVersion: string | null
  pushProvider: string | null
  pushTokenUpdatedAt?: string | null
  lastSeenAt?: string | null
  createdAt?: string | null
  updatedAt: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(record: Record<string, unknown>, snakeKey: string, camelKey: string): string | null {
  const value = record[snakeKey] ?? record[camelKey]
  return typeof value === 'string' ? value : null
}

export function toIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  return null
}

const deprecatedAlias = (of: string) => `Deprecated alias for \`${of}\`; removed in the next minor release.`

export const deviceListItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid(),
  deviceId: z.string(),
  platform: z.enum(['ios', 'android', 'web']),
  clientAppVersion: z.string().nullable().optional(),
  osVersion: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  pushProvider: z.string().nullable().optional(),
  pushTokenUpdatedAt: z.string().nullable().optional(),
  lastSeenAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  tenant_id: z.string().uuid().describe(deprecatedAlias('tenantId')),
  organization_id: z.string().uuid().nullable().optional().describe(deprecatedAlias('organizationId')),
  user_id: z.string().uuid().describe(deprecatedAlias('userId')),
  device_id: z.string().describe(deprecatedAlias('deviceId')),
  client_app_version: z.string().nullable().optional().describe(deprecatedAlias('clientAppVersion')),
  os_version: z.string().nullable().optional().describe(deprecatedAlias('osVersion')),
  push_provider: z.string().nullable().optional().describe(deprecatedAlias('pushProvider')),
  push_token_updated_at: z.string().nullable().optional().describe(deprecatedAlias('pushTokenUpdatedAt')),
  last_seen_at: z.string().nullable().optional().describe(deprecatedAlias('lastSeenAt')),
  created_at: z.string().nullable().optional().describe(deprecatedAlias('createdAt')),
  updated_at: z.string().nullable().optional().describe(deprecatedAlias('updatedAt')),
})
