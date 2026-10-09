/**
 * Phase 3 Track C — webhook bridge.
 *
 * Forwards `forms.submission.submitted` and `forms.submission.anonymized`
 * events to the project's webhooks module. Payloads are id-only (no
 * sensitive fields) by construction in the catalog (`events-payloads.ts`).
 *
 * The subscriber is `persistent: true` so retries are at-least-once.
 * Idempotent forwarding is the responsibility of the webhooks module.
 */

export const metadata = {
  event: 'forms.submission.submitted',
  persistent: true,
  id: 'forms.webhook-bridge.submitted',
}

type Payload = {
  submissionId: string
}

export default async function handleSubmissionSubmitted(payload: Payload, ctx: {
  container: { resolve: (key: string) => unknown }
}): Promise<void> {
  const dispatcher = tryResolve(ctx.container, 'webhookDispatcher')
  if (!dispatcher) return
  await callDispatcher(dispatcher, {
    event: 'forms.submission.submitted',
    payload: {
      submissionId: payload.submissionId,
      emittedAt: new Date().toISOString(),
    },
  })
}

function tryResolve(
  container: { resolve: (key: string) => unknown },
  key: string,
): { dispatch: (event: { event: string; payload: unknown }) => Promise<void> } | null {
  try {
    const resolved = container.resolve(key)
    if (resolved && typeof (resolved as { dispatch?: unknown }).dispatch === 'function') {
      return resolved as { dispatch: (event: { event: string; payload: unknown }) => Promise<void> }
    }
    return null
  } catch {
    return null
  }
}

async function callDispatcher(
  dispatcher: { dispatch: (event: { event: string; payload: unknown }) => Promise<void> },
  event: { event: string; payload: unknown },
): Promise<void> {
  await dispatcher.dispatch(event)
}
