import { z } from 'zod'
import { buildPasswordSchema } from '@open-mercato/shared/lib/auth/passwordPolicy'

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

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>
