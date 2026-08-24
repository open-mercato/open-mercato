import { z } from 'zod'
import type { UserDevice } from '../data/entities'
import { toDeprecatedSnakeCaseAliases, toIso } from './deviceList'

// Detail contract for `GET /api/devices/admin/devices/:id`. Keys are camelCase like every other
// module's responses (#5513); the snake_case keys stay alongside as deprecated aliases for one minor
// version, per the deprecation protocol in BACKWARD_COMPATIBILITY.md § 7.
// push_token is a secret and is never returned.
export function serializeDeviceDetail(device: UserDevice): Record<string, unknown> {
  const camel = {
    id: device.id,
    userId: device.userId,
    deviceId: device.deviceId,
    platform: device.platform,
    clientAppVersion: device.clientAppVersion ?? null,
    osVersion: device.osVersion ?? null,
    pushProvider: device.pushProvider ?? null,
    pushTokenUpdatedAt: toIso(device.pushTokenUpdatedAt),
    lastSeenAt: toIso(device.lastSeenAt),
    createdAt: toIso(device.createdAt),
    updatedAt: toIso(device.updatedAt),
  }
  return { ...camel, ...toDeprecatedSnakeCaseAliases(camel) }
}

const deprecatedAlias = (of: string) => `Deprecated alias for \`${of}\`; removed in the next minor release.`

export const deviceDetailItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  deviceId: z.string(),
  platform: z.enum(['ios', 'android', 'web']),
  clientAppVersion: z.string().nullable(),
  osVersion: z.string().nullable(),
  pushProvider: z.string().nullable(),
  pushTokenUpdatedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  user_id: z.string().uuid().describe(deprecatedAlias('userId')),
  device_id: z.string().describe(deprecatedAlias('deviceId')),
  client_app_version: z.string().nullable().describe(deprecatedAlias('clientAppVersion')),
  os_version: z.string().nullable().describe(deprecatedAlias('osVersion')),
  push_provider: z.string().nullable().describe(deprecatedAlias('pushProvider')),
  push_token_updated_at: z.string().nullable().describe(deprecatedAlias('pushTokenUpdatedAt')),
  last_seen_at: z.string().nullable().describe(deprecatedAlias('lastSeenAt')),
  created_at: z.string().nullable().describe(deprecatedAlias('createdAt')),
  updated_at: z.string().nullable().describe(deprecatedAlias('updatedAt')),
})
