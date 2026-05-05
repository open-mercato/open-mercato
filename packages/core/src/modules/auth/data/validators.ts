import { z } from 'zod'
import { buildPasswordSchema } from '@open-mercato/shared/lib/auth/passwordPolicy'

const passwordSchema = buildPasswordSchema()

// Core auth validators
export const userLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  requireRole: z.string().optional(),
  tenantId: z.string().uuid().optional(),
})

export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
})

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
})

export const refreshSessionRequestSchema = z.object({
  refreshToken: z.string().min(1),
})

export const sidebarPreferencesScopeSchema = z.union([
  z.object({ type: z.literal('user') }),
  z.object({ type: z.literal('role'), roleId: z.string().uuid() }),
])

// Sidebar settings shape shared by both `sidebarPreferencesInputSchema` (which
// adds role-targeting fields) and the variants API (which uses just the
// settings + name + isActive). Keeping the field constraints in one place
// prevents drift between the preferences and variants surfaces.
export const sidebarVariantSettingsSchema = z.object({
  version: z.number().int().positive().optional(),
  groupOrder: z.array(z.string().min(1)).max(200).optional(),
  groupLabels: z.record(z.string().min(1), z.string().min(1).max(120)).optional(),
  itemLabels: z.record(z.string().min(1), z.string().min(1).max(120)).optional(),
  hiddenItems: z.array(z.string().min(1)).max(500).optional(),
  itemOrder: z.record(z.string().min(1), z.array(z.string().min(1)).max(500)).optional(),
})

export const createSidebarVariantInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  settings: sidebarVariantSettingsSchema.optional(),
  isActive: z.boolean().optional(),
})

export const updateSidebarVariantInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  settings: sidebarVariantSettingsSchema.optional(),
  isActive: z.boolean().optional(),
})

export const sidebarVariantRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  settings: z.object({
    version: z.number().int().positive(),
    groupOrder: z.array(z.string()),
    groupLabels: z.record(z.string(), z.string()),
    itemLabels: z.record(z.string(), z.string()),
    hiddenItems: z.array(z.string()),
    itemOrder: z.record(z.string(), z.array(z.string())),
  }),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export const sidebarPreferencesInputSchema = z.object({
  version: z.number().int().positive().optional(),
  groupOrder: z.array(z.string().min(1)).max(200).optional(),
  groupLabels: z.record(z.string().min(1), z.string().min(1).max(120)).optional(),
  itemLabels: z.record(z.string().min(1), z.string().min(1).max(120)).optional(),
  hiddenItems: z.array(z.string().min(1)).max(500).optional(),
  itemOrder: z.record(z.string().min(1), z.array(z.string().min(1)).max(500)).optional(),
  applyToRoles: z.array(z.string().uuid()).optional(),
  clearRoleIds: z.array(z.string().uuid()).optional(),
  scope: sidebarPreferencesScopeSchema.optional(),
}).superRefine((value, ctx) => {
  const scopeType = value.scope?.type ?? 'user'
  if (scopeType === 'role') {
    if ((value.applyToRoles?.length ?? 0) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applyToRoles'],
        message: 'applyToRoles is only valid when scope.type === "user"',
      })
    }
    if ((value.clearRoleIds?.length ?? 0) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clearRoleIds'],
        message: 'clearRoleIds is only valid when scope.type === "user"',
      })
    }
  }
})

// Optional helpers for CLI or admin forms
export const userCreateSchema = z.object({
  email: z.string().email(),
  password: passwordSchema.optional(),
  sendInviteEmail: z.boolean().optional(),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  rolesCsv: z.string().optional(),
}).refine(
  (data) => data.password || data.sendInviteEmail,
  { message: 'Either password or sendInviteEmail is required', path: ['password'] },
)

export const featureCheckRequestSchema = z.object({
  features: z.array(z.string().max(128)).max(50).describe('Feature identifiers to check'),
}).describe('Batch feature check payload')

export type UserLoginInput = z.infer<typeof userLoginSchema>
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>
export type RefreshSessionRequestInput = z.infer<typeof refreshSessionRequestSchema>
export type SidebarPreferencesInput = z.infer<typeof sidebarPreferencesInputSchema>
export type SidebarVariantSettingsInput = z.infer<typeof sidebarVariantSettingsSchema>
export type CreateSidebarVariantInput = z.infer<typeof createSidebarVariantInputSchema>
export type UpdateSidebarVariantInput = z.infer<typeof updateSidebarVariantInputSchema>
export type SidebarVariantRecordResponse = z.infer<typeof sidebarVariantRecordSchema>
export type UserCreateInput = z.infer<typeof userCreateSchema>
export type FeatureCheckRequestInput = z.infer<typeof featureCheckRequestSchema>
