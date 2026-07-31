import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'

export type BestEffortProvisioningResult = { ok: true } | { ok: false; error: unknown }

type BestEffortLogger = Pick<Console, 'error' | 'info'>

/**
 * Runs a non-essential provisioning step without letting its failure abort
 * onboarding. The tenant/org/primary user are created before these steps, so a
 * throw or timeout here (reference-data seeding, marketing-consent recording)
 * must NOT strand a freshly provisioned workspace — the verify handler still has
 * to reach markCompleted so the user can sign in. Failures are logged for
 * follow-up and reported back to the caller, never re-thrown.
 */
export async function runBestEffortProvisioningStep(
  step: string,
  run: () => Promise<void>,
  logger: BestEffortLogger = console,
): Promise<BestEffortProvisioningResult> {
  try {
    await run()
    return { ok: true }
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Expected when a concurrent verify / re-verify re-applies a step against
      // rows that already exist (seed hooks are not fully idempotent). The
      // workspace is already provisioned, so the collision is harmless — log at
      // info to keep genuine non-fatal failures visible.
      logger.info('[onboarding.verify] non-fatal provisioning step skipped (already applied)', { step })
      return { ok: false, error }
    }
    logger.error('[onboarding.verify] non-fatal provisioning step failed', { step, error })
    return { ok: false, error }
  }
}
