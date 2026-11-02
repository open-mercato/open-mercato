/**
 * Phase 3 Track C — webhook bridge for anonymized events.
 * See `forms-webhook-bridge.ts` for the rationale.
 */

export const metadata = {
  event: 'forms.submission.anonymized',
  persistent: true,
  id: 'forms.webhook-bridge.anonymized',
}

type Payload = {
  submissionId: string
}

export default async function handleSubmissionAnonymized(payload: Payload, ctx: {
  container: { resolve: (key: string) => unknown }
}): Promise<void> {
  let dispatcher: { dispatch: (event: { event: string; payload: unknown }) => Promise<void> } | null = null
  try {
    const resolved = ctx.container.resolve('webhookDispatcher')
    if (resolved && typeof (resolved as { dispatch?: unknown }).dispatch === 'function') {
      dispatcher = resolved as { dispatch: (event: { event: string; payload: unknown }) => Promise<void> }
    }
  } catch {
    return
  }
  if (!dispatcher) return
  await dispatcher.dispatch({
    event: 'forms.submission.anonymized',
    payload: {
      submissionId: payload.submissionId,
      emittedAt: new Date().toISOString(),
    },
  })
}
