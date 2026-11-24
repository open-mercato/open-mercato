import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { SignInMfaReceiptStatus } from '../data/entities'
import { lockSignInAttempt } from './sign-in-activity-locks'

export type SignInMfaIdentity = {
  tenantId: string
  userId: string
  attemptId: string
}

type Receipt = {
  status: SignInMfaReceiptStatus
  challengeId?: string
  verifiedAt?: Date
}

export async function persistSignInMfaReceipt(em: EntityManager, identity: SignInMfaIdentity, receipt: Receipt) {
  const { tenantId, userId, attemptId } = identity
  await lockSignInAttempt(em, tenantId, attemptId)
  const rows = await em.execute<{ status: SignInMfaReceiptStatus }[]>(
    `insert into security_sign_in_mfa_receipts
       (tenant_id, user_id, source_attempt_id, challenge_id, status, verified_at, created_at)
       values (?, ?, ?, ?, ?, ?, now())
       on conflict (tenant_id, source_attempt_id) do update
       set status = case when security_sign_in_mfa_receipts.status = 'verified' then 'verified' else excluded.status end,
           verified_at = coalesce(security_sign_in_mfa_receipts.verified_at, excluded.verified_at)
       where security_sign_in_mfa_receipts.user_id = excluded.user_id
       and security_sign_in_mfa_receipts.challenge_id is not distinct from excluded.challenge_id
       returning status`,
    [tenantId, userId, attemptId, receipt.challengeId ?? null, receipt.status, receipt.verifiedAt ?? null],
  )
  const saved = rows[0]
  if (!saved) throw new Error('[internal] Conflicting sign-in MFA receipt identity')
  await em.execute(
    `update security_sign_in_attempts set mfa_status = ?
       where tenant_id = ? and source_attempt_id = ? and user_id = ? and result = 'success'
       and mfa_status is distinct from 'verified'`,
    [saved.status, tenantId, attemptId, userId],
  )
}

const logger = createLogger('security.sign-in-activity')
type ReportCode =
  | 'security.sign_in_mfa_receipt_failed'
  | 'security.sign_in_mfa_claims_invalid'
  | 'security.sign_in_mfa_challenge_failed'
  | 'security.sign_in_mfa_service_unavailable'

export function reportSignInMfaFailure(code: ReportCode) {
  const message = 'Unable to record sign-in MFA outcome'
  try {
    logger.warn(message, { code })
  } catch {
    // Instrumentation must preserve the login result.
  }
  try {
    getTelemetryRuntime()?.reportError(new Error(message), { module: 'security', code })
  } catch {
    // Instrumentation must preserve the login result.
  }
}
