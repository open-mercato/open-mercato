import { z } from 'zod'
import { buildPasswordSchema } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { EnforcementScope } from './entities'

const passwordSchema = buildPasswordSchema()

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
})

export const mfaVerifySchema = z.object({
  challengeId: z.string().min(1),
  methodType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
})

export const enforcementPolicySchema = z.object({
  scope: z.nativeEnum(EnforcementScope),
  tenantId: z.string().uuid().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  isEnforced: z.boolean().default(true),
  allowedMethods: z.array(z.string().min(1)).nullable().optional(),
  enforcementDeadline: z.coerce.date().nullable().optional(),
})

export const updateEnforcementPolicySchema = enforcementPolicySchema.partial()

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>
export type EnforcementPolicyInput = z.infer<typeof enforcementPolicySchema>
export type UpdateEnforcementPolicyInput = z.infer<typeof updateEnforcementPolicySchema>
