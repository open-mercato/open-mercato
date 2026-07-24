export type IncidentAiFailure = {
  status: number | null
  code: string | null
}

export function extractIncidentAiFailure(status: number | null, body: unknown): IncidentAiFailure {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  const code = record && typeof record.code === 'string' && record.code.length > 0 ? record.code : null
  return { status, code }
}

type Translate = (key: string, fallback?: string) => string

export function resolveIncidentAiErrorMessage(
  failure: IncidentAiFailure,
  t: Translate,
  fallbackKey: string,
  fallbackText: string,
): string {
  if (failure.code === 'no_provider_configured') {
    return t('incidents.ai.errors.noProvider', 'AI is not configured for this workspace. Add an AI provider to enable this action.')
  }
  if (failure.code === 'api_key_missing') {
    return t('incidents.ai.errors.apiKeyMissing', 'The configured AI provider has no API key. Add a key to enable this action.')
  }
  if (failure.status === 403) {
    return t('incidents.ai.errors.forbidden', "You don't have permission to use AI features on incidents.")
  }
  if (failure.code === 'incident_not_found' || failure.status === 404) {
    return t('incidents.ai.errors.notFound', 'This incident could not be loaded. Refresh the page and try again.')
  }
  if (failure.code === 'ai_unavailable' || failure.status === 503) {
    return t('incidents.ai.errors.unavailable', 'The AI runtime is unavailable right now. Try again shortly.')
  }
  return t(fallbackKey, fallbackText)
}
