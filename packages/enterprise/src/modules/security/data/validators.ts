import { z } from 'zod'
import { buildPasswordSchema } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { ChallengeMethod, EnforcementScope } from './entities'
import { readSecurityModuleConfig } from '../lib/security-config'

const passwordSchema = buildPasswordSchema()
const securityConfig = readSecurityModuleConfig()

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
})

export const mfaVerifySchema = z.object({
  challengeId: z.string().min(1),
  methodType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
})

export const removeMfaMethodSchema = z.object({
  id: z.string().uuid(),
})

export const regenerateRecoveryCodesSchema = z.object({})

export const enforcementPolicySchema = z.object({
  scope: z.nativeEnum(EnforcementScope),
  tenantId: z.string().uuid().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  isEnforced: z.boolean().default(true),
  allowedMethods: z.array(z.string().min(1)).nullable().optional(),
  enforcementDeadline: z.coerce.date().nullable().optional(),
})

export const updateEnforcementPolicySchema = enforcementPolicySchema.partial()

export const sudoChallengeInitSchema = z.object({
  targetIdentifier: z.string().min(1),
})

export const sudoChallengePrepareSchema = z.object({
  sessionId: z.string().uuid(),
  methodType: z.string().min(1),
})

export const sudoChallengeVerifySchema = z.object({
  sessionId: z.string().uuid(),
  targetIdentifier: z.string().min(1),
  methodType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
})

export const sudoConfigSchema = z.object({
  tenantId: z.string().uuid().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  label: z.string().max(200).nullable().optional(),
  targetIdentifier: z.string().min(1),
  isEnabled: z.boolean().default(true),
  ttlSeconds: z.coerce.number()
    .int()
    .min(securityConfig.sudo.minTtlSeconds)
    .max(securityConfig.sudo.maxTtlSeconds)
    .default(securityConfig.sudo.defaultTtlSeconds),
  challengeMethod: z.nativeEnum(ChallengeMethod).default(ChallengeMethod.AUTO),
})

export const sudoConfigUpdateSchema = sudoConfigSchema.partial()

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>
export type RemoveMfaMethodInput = z.infer<typeof removeMfaMethodSchema>
export type RegenerateRecoveryCodesInput = z.infer<typeof regenerateRecoveryCodesSchema>
export type EnforcementPolicyInput = z.infer<typeof enforcementPolicySchema>
export type UpdateEnforcementPolicyInput = z.infer<typeof updateEnforcementPolicySchema>
export type SudoChallengeInitInput = z.infer<typeof sudoChallengeInitSchema>
export type SudoChallengePrepareInput = z.infer<typeof sudoChallengePrepareSchema>
export type SudoChallengeVerifyInput = z.infer<typeof sudoChallengeVerifySchema>
export type SudoConfigInput = z.infer<typeof sudoConfigSchema>
export type SudoConfigUpdateInput = z.infer<typeof sudoConfigUpdateSchema>
