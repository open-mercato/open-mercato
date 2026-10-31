import { OAuthGrantError } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import type { IntegrationOAuthGrantService } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { AdvisoryLockUnavailableError } from '@open-mercato/shared/lib/db/advisoryLock'
import { XERO_INTEGRATION_ID } from './constants'
import { XeroTestFakesUnavailableError } from './endpoints'
import { XeroApiError } from './errors'
import type { XeroScope } from './owner'
import { parseXeroProviderData } from './provider-data'

export type XeroRunOrigin = 'scheduled' | 'manual'

/** Only a run whose `triggeredBy` is exactly 'scheduler' is scheduled; a missing run counts as scheduled (App Spec § 6.5). */
export async function resolveXeroRunOrigin(
  runService: { getRun(runId: string, scope: XeroScope): Promise<{ triggeredBy?: string | null } | null> },
  runId: string | undefined,
  scope: XeroScope,
): Promise<XeroRunOrigin> {
  if (!runId) return 'scheduled'
  const run = await runService.getRun(runId, scope)
  if (!run) return 'scheduled'
  return run.triggeredBy === 'scheduler' ? 'scheduled' : 'manual'
}

export type XeroQuietEndCode = 'xero.run_stopped_not_connected' | 'xero.run_stopped_invalidated' | 'xero.account_pending' | 'xero.daily_limit_reached'

export type XeroRunFailureCode =
  | 'xero.account_pending'
  | 'xero.organisation_changed'
  | 'xero.transient'
  | 'xero.platform_unavailable'
  | 'xero.unauthorized'
  | 'xero.forbidden'
  | 'xero.request_rejected'
  | 'xero.client_misconfigured'
  | 'xero.scope_insufficient'
  | 'xero.organisation_not_authorised'
  | 'xero.claim_lock_unavailable'
  | 'xero.test_fakes_unavailable'

/** Fixed English sentences: a quiet end's log message or the run's failure message after its code. Never personal data. */
export const XERO_RUN_MESSAGES: Record<XeroQuietEndCode | XeroRunFailureCode, string> = {
  'xero.run_stopped_not_connected': 'Xero is not connected for this organization; the run stopped without changes. Connect on the Xero tab.',
  'xero.run_stopped_invalidated': 'Xero access was revoked or expired; the run stopped. Reconnect on the Xero tab.',
  'xero.account_pending': 'No Xero Organisation is chosen yet; choose it on the Xero tab.',
  'xero.daily_limit_reached': "Xero's daily API limit for this Organisation is reached; the next run continues where this one stopped.",
  'xero.organisation_changed': 'The Xero Organisation changed during the run; the next run syncs the new one.',
  'xero.transient': 'Xero or the Xero connection is temporarily unavailable; the next run resumes from the last saved position.',
  'xero.platform_unavailable': 'The stored Xero connection cannot be read right now (the encryption key may be unavailable).',
  'xero.unauthorized': 'Xero rejected the access token twice; reconnect on the Xero tab.',
  'xero.forbidden': "Xero refused access to the Organisation; check the Xero user's access to it.",
  'xero.request_rejected': 'Xero rejected the request.',
  'xero.client_misconfigured': 'Xero rejected the client; check the Client ID and Secret on the Credentials tab.',
  'xero.scope_insufficient': 'The Xero connection lacks a required permission; reconnect on the Xero tab and allow it.',
  'xero.organisation_not_authorised': 'The Xero Organisation is no longer part of the connection; reconnect and select it.',
  'xero.claim_lock_unavailable': 'Another Xero import held the Company lock too long; the next run resumes from the last saved position.',
  'xero.test_fakes_unavailable': 'The Xero test fakes of this organization are not running.',
}

export class XeroRunFailure extends Error {
  readonly code: XeroRunFailureCode
  readonly status: number | null

  constructor(code: XeroRunFailureCode, options: { status?: number | null; cause?: unknown } = {}) {
    const status = options.status ?? null
    const suffix = code === 'xero.request_rejected' && status !== null ? ` (HTTP ${status})` : ''
    super(`${code}: ${XERO_RUN_MESSAGES[code]}${suffix}`, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'XeroRunFailure'
    this.code = code
    this.status = status
  }
}

export type XeroRunOutcome = { kind: 'quiet'; code: XeroQuietEndCode } | { kind: 'fail'; failure: XeroRunFailure }

/**
 * Maps a failure of a token call or a Xero response to the run outcome of the grant-state table:
 * a quiet end (the run completes and logs one warning) or a failure (the run fails with a message
 * that starts with the `xero.*` code). Anything unknown is rethrown by the caller.
 */
export function classifyXeroRunError(error: unknown, origin: XeroRunOrigin): XeroRunOutcome | null {
  if (error instanceof XeroRunFailure) return { kind: 'fail', failure: error }
  if (error instanceof XeroTestFakesUnavailableError) return { kind: 'fail', failure: new XeroRunFailure('xero.test_fakes_unavailable', { cause: error }) }
  if (error instanceof AdvisoryLockUnavailableError) return { kind: 'fail', failure: new XeroRunFailure('xero.claim_lock_unavailable', { cause: error }) }
  if (error instanceof OAuthGrantError) {
    switch (error.code) {
      case 'not_connected':
        return { kind: 'quiet', code: 'xero.run_stopped_not_connected' }
      case 'grant_invalidated':
        return { kind: 'quiet', code: 'xero.run_stopped_invalidated' }
      case 'client_misconfigured':
        return { kind: 'fail', failure: new XeroRunFailure('xero.client_misconfigured', { cause: error }) }
      case 'platform_unavailable':
        return { kind: 'fail', failure: new XeroRunFailure('xero.platform_unavailable', { cause: error }) }
      case 'transient':
        return { kind: 'fail', failure: new XeroRunFailure('xero.transient', { cause: error }) }
      default:
        return { kind: 'fail', failure: new XeroRunFailure('xero.transient', { cause: error }) }
    }
  }
  if (error instanceof XeroApiError) {
    switch (error.code) {
      case 'daily_limit':
        return { kind: 'quiet', code: 'xero.daily_limit_reached' }
      case 'scope_insufficient':
        return { kind: 'fail', failure: new XeroRunFailure('xero.scope_insufficient', { status: error.status, cause: error }) }
      case 'unauthorized':
        return { kind: 'fail', failure: new XeroRunFailure('xero.unauthorized', { status: error.status, cause: error }) }
      case 'forbidden':
        return { kind: 'fail', failure: new XeroRunFailure('xero.forbidden', { status: error.status, cause: error }) }
      case 'organisation_not_authorised':
        return { kind: 'fail', failure: new XeroRunFailure('xero.organisation_not_authorised', { status: error.status, cause: error }) }
      case 'request_rejected':
        return { kind: 'fail', failure: new XeroRunFailure('xero.request_rejected', { status: error.status, cause: error }) }
      default:
        return { kind: 'fail', failure: new XeroRunFailure('xero.transient', { status: error.status, cause: error }) }
    }
  }
  return null
}

/**
 * The Organisation a token's `providerData` names, against the one the run started with: pending
 * (none chosen) ends a scheduled run quietly and fails a manual one; a different one fails the run.
 */
export function checkRunOrganisation(
  providerData: Record<string, unknown> | null,
  input: { expected: string | null; origin: XeroRunOrigin },
): { kind: 'ok'; xeroOrganisationId: string } | XeroRunOutcome {
  const organisation = parseXeroProviderData(providerData)
  if (!organisation) {
    return input.origin === 'scheduled'
      ? { kind: 'quiet', code: 'xero.account_pending' }
      : { kind: 'fail', failure: new XeroRunFailure('xero.account_pending') }
  }
  if (input.expected !== null && organisation.xeroOrganisationId !== input.expected) {
    return { kind: 'fail', failure: new XeroRunFailure('xero.organisation_changed') }
  }
  return { kind: 'ok', xeroOrganisationId: organisation.xeroOrganisationId }
}

const PRESENCE_REUSE_MS = 1000

/**
 * The per-item grant presence check (App Spec § 6.5): `readGrantStatus` before each item's write,
 * with a non-null answer reused for at most one second and `null` never reused.
 */
export function createGrantPresenceCheck(
  grantService: Pick<IntegrationOAuthGrantService, 'readGrantStatus'>,
  scope: XeroScope,
  now: () => number = Date.now,
): () => Promise<boolean> {
  let presentUntil = 0
  return async () => {
    if (now() < presentUntil) return true
    const status = await grantService.readGrantStatus(XERO_INTEGRATION_ID, scope)
    if (status === null) {
      presentUntil = 0
      return false
    }
    presentUntil = now() + PRESENCE_REUSE_MS
    return true
  }
}
