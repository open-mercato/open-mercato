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

export const sidebarPreferencesInputSchema = z.object({
  version: z.number().int().positive().optional(),
  groupOrder: z.array(z.string().min(1)).max(200).optional(),
  groupLabels: z.record(z.string().min(1), z.string().min(1).max(120)).optional(),
  itemLabels: z.record(z.string().min(1), z.string().min(1).max(120)).optional(),
  hiddenItems: z.array(z.string().min(1)).max(500).optional(),
  applyToRoles: z.array(z.string().uuid()).optional(),
  clearRoleIds: z.array(z.string().uuid()).optional(),
})

export const AccessibilityPreferencesSchema = z.object({
  highContrast: z.boolean().optional(),
  fontSize: z.enum(['sm', 'md', 'lg', 'xl']).optional(),
  reducedMotion: z.boolean().optional(),
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
export type AccessibilityPreferences = z.infer<typeof AccessibilityPreferencesSchema>
export type UserCreateInput = z.infer<typeof userCreateSchema>
export type FeatureCheckRequestInput = z.infer<typeof featureCheckRequestSchema>
