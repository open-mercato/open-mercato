import { z } from 'zod'
import { signAudienceJwt, verifyAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'

export const MFA_PENDING_AUDIENCE = 'mfa_pending'
export const MFA_PENDING_TTL_SECONDS = 60 * 10

const pendingMfaClaimsSchema = z.object({
  sub: z.string().min(1),
  sid: z.string().min(1),
  tenantId: z.string().nullable(),
  orgId: z.string().nullable(),
  email: z.string().nullable().optional(),
  roles: z.array(z.string()).default([]),
  mfa_pending: z.literal(true),
  mfa_verified: z.literal(false),
}).passthrough()

export type PendingMfaClaims = z.infer<typeof pendingMfaClaimsSchema>

export function signPendingMfaToken(
  claims: Omit<PendingMfaClaims, 'mfa_pending' | 'mfa_verified'>,
): string {
  return signAudienceJwt(
    MFA_PENDING_AUDIENCE,
    {
      ...claims,
      mfa_pending: true,
      mfa_verified: false,
    },
    MFA_PENDING_TTL_SECONDS,
  )
}

export function verifyPendingMfaToken(token: string): PendingMfaClaims | null {
  const parsed = pendingMfaClaimsSchema.safeParse(verifyAudienceJwt(MFA_PENDING_AUDIENCE, token))
  return parsed.success ? parsed.data : null
}
