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

export const deviceListItemSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  organization_id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid(),
  device_id: z.string(),
  platform: z.enum(['ios', 'android', 'web']),
  client_app_version: z.string().nullable().optional(),
  os_version: z.string().nullable().optional(),
  push_provider: z.string().nullable().optional(),
  push_token_updated_at: z.string().nullable().optional(),
  last_seen_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})
