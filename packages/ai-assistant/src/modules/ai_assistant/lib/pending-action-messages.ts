import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const TOOL_FEATURES_DENIED_MESSAGE_FALLBACK = "Caller lacks one of the tool's required features: {features}"

/**
 * Localized message for the `tool_features_denied` refusal, shared by the
 * confirm re-check and the executor so both paths answer in the caller's
 * locale. The stable `code` stays on the envelope for programmatic clients.
 */
export async function resolveToolFeaturesDeniedMessage(requiredFeatures: string[]): Promise<string> {
  const { translate } = await resolveTranslations()
  return translate('ai_assistant.errors.toolFeaturesDenied', TOOL_FEATURES_DENIED_MESSAGE_FALLBACK, {
    features: requiredFeatures.join(', '),
  })
}
