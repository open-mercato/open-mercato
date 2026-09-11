import type { PullBlocker } from './pull-readiness'

// Routes answer with a stable code and the widgets own the wording, so a non-English user never
// sees a server string. `message` stays in the payload for API consumers and logs only.
export const TILLIO_ERROR_CODES = [
  'unauthorized',
  'invalid_payload',
  'invalid_operator_id',
  'integration_disabled',
  'environment_not_ready',
  'operator_missing',
  'environment_drift',
  'pull_already_running',
  'pull_failed',
  'app_url_missing',
  'operator_limit',
  'provider_error',
  'revocation_failed',
  'attach_failed',
  'detach_failed',
] as const

export type TillioErrorCode = typeof TILLIO_ERROR_CODES[number]

type TillioErrorCopy = { key: string; fallback: string }

const COPY: Record<TillioErrorCode, TillioErrorCopy> = {
  unauthorized: { key: 'tillio.errors.unauthorized', fallback: 'Your session expired. Sign in again.' },
  invalid_payload: { key: 'tillio.errors.invalidPayload', fallback: 'The request was rejected as invalid.' },
  invalid_operator_id: { key: 'tillio.errors.invalidOperatorId', fallback: 'That operator id is not valid.' },
  integration_disabled: { key: 'tillio.errors.integrationDisabled', fallback: 'The Tillio integration is disabled. Enable it first.' },
  environment_not_ready: { key: 'tillio.errors.environmentNotReady', fallback: 'Configure the Tillio credentials and run the health check first.' },
  operator_missing: { key: 'tillio.errors.operatorMissing', fallback: 'Attach a Tillio operator first.' },
  environment_drift: { key: 'tillio.errors.environmentDrift', fallback: 'The environment changed after the operator was attached. Detach and attach it again.' },
  pull_already_running: { key: 'tillio.errors.pullAlreadyRunning', fallback: 'A pull is already running. Wait for it to finish.' },
  pull_failed: { key: 'tillio.errors.pullFailed', fallback: 'Could not pull calls from Tillio.' },
  app_url_missing: { key: 'tillio.errors.appUrlMissing', fallback: 'APP_URL is not configured, so the operator webhook domain cannot be derived.' },
  operator_limit: { key: 'tillio.errors.operatorLimit', fallback: 'An operator is already attached. Detach it first.' },
  provider_error: { key: 'tillio.errors.providerError', fallback: 'Tillio rejected the request.' },
  revocation_failed: { key: 'tillio.errors.revocationFailed', fallback: 'The Tillio token could not be revoked.' },
  attach_failed: { key: 'tillio.errors.attachFailed', fallback: 'Could not attach the operator.' },
  detach_failed: { key: 'tillio.errors.detachFailed', fallback: 'Could not detach the operator.' },
}

export function tillioErrorCopy(code: string | null | undefined, fallbackCode: TillioErrorCode): TillioErrorCopy {
  const known = TILLIO_ERROR_CODES.find((entry) => entry === code)
  return COPY[known ?? fallbackCode]
}

// Keyed by the shared union so a blocker the server learns to report cannot reach the dialog
// unworded: adding one to `PullBlocker` fails this record until it gets copy of its own. The pull
// entries are worded for the action in progress, which the generic `COPY` above cannot be.
export const PULL_BLOCKER_COPY: Record<PullBlocker, TillioErrorCopy> = {
  integration_disabled: COPY.integration_disabled,
  environment_not_ready: {
    key: 'tillio.pull.envNotReady',
    fallback: 'Configure the Tillio credentials and run the health check on the integration page first.',
  },
  operator_missing: {
    key: 'tillio.pull.operatorMissing',
    fallback: 'Attach a Tillio operator on the integration page before pulling calls.',
  },
  environment_drift: {
    key: 'tillio.pull.envDrift',
    fallback: 'The Tillio environment changed after the operator was attached. Detach and attach it again before pulling calls.',
  },
}
