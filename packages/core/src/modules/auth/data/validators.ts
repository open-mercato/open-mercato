import { z } from 'zod'
import { buildPasswordSchema } from '@open-mercato/shared/lib/auth/passwordPolicy'

const passwordSchema = buildPasswordSchema()

// Core auth validators
export const userLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  requireRole: z.string().optional(),
})

export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
})

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
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

// Optional helpers for CLI or admin forms
export const userCreateSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  rolesCsv: z.string().optional(),
})

export type UserLoginInput = z.infer<typeof userLoginSchema>
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>
export type SidebarPreferencesInput = z.infer<typeof sidebarPreferencesInputSchema>
export type UserCreateInput = z.infer<typeof userCreateSchema>
