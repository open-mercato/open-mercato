import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export function localizeIntegrationHealthMessage(
  message: string | null,
  details: Record<string, unknown>,
  translate: TranslateFn,
): string | null {
  if (details.reason === 'missing_oauth_state_secret') {
    return translate('integrations.detail.health.missingOauthStateSecret')
  }
  return message
}
