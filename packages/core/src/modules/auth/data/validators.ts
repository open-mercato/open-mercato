import { z } from 'zod'

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
  password: z.string().min(6),
})

// Optional helpers for CLI or admin forms
export const userCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  rolesCsv: z.string().optional(),
})

export type UserLoginInput = z.infer<typeof userLoginSchema>
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>
export type UserCreateInput = z.infer<typeof userCreateSchema>

