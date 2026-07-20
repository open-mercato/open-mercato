import { z } from 'zod'

export const devicePlatformSchema = z.enum(['ios', 'android', 'web'])
export type DevicePlatformInput = z.infer<typeof devicePlatformSchema>

// POST /api/devices — register/upsert. pushToken/pushProvider optional on first register.
export const registerDeviceSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(255),
    platform: devicePlatformSchema,
    clientAppVersion: z.string().trim().max(64).nullish(),
    osVersion: z.string().trim().max(64).nullish(),
    locale: z.string().trim().min(2).max(35).nullish(),
    pushToken: z.string().trim().min(1).max(4096).nullish(),
    pushProvider: z.string().trim().min(1).max(32).nullish(),
  })
  .strict()
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>

// POST /api/devices/admin/devices — admin registers a device on behalf of any user in the tenant.
// Same shape as self-register plus an explicit target userId (self-register derives it from auth).
export const registerDeviceAdminSchema = registerDeviceSchema.extend({
  userId: z.string().uuid(),
})
export type RegisterDeviceAdminInput = z.infer<typeof registerDeviceAdminSchema>

// PUT /api/devices/:id — partial update.
// pushToken/pushProvider are tri-state: absent (leave unchanged) vs explicit null (clear).
// `.nullable().optional()` distinguishes `undefined` from `null`; the command relies on
// own-property presence to decide whether to touch the column.
export const updateDeviceSchema = z
  .object({
    clientAppVersion: z.string().trim().max(64).nullable().optional(),
    osVersion: z.string().trim().max(64).nullable().optional(),
    locale: z.string().trim().min(2).max(35).nullable().optional(),
    pushToken: z.string().trim().min(1).max(4096).nullable().optional(),
    pushProvider: z.string().trim().min(1).max(32).nullable().optional(),
    lastSeenAt: z.coerce.date().optional(),
  })
  .strict()
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>

// Command-side schemas append the resolved scope. Scope fields are never accepted from the client body.
export const registerDeviceCommandSchema = registerDeviceSchema.extend({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid(),
})
export type RegisterDeviceCommandInput = z.infer<typeof registerDeviceCommandSchema>

export const updateDeviceCommandSchema = updateDeviceSchema.extend({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  organizationId: z.string().uuid().nullable().optional(),
})
export type UpdateDeviceCommandInput = z.infer<typeof updateDeviceCommandSchema>

export const deactivateDeviceCommandSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  organizationId: z.string().uuid().nullable().optional(),
})
export type DeactivateDeviceCommandInput = z.infer<typeof deactivateDeviceCommandSchema>
