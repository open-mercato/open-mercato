import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { ProviderAvailability } from './provider-probe'

export function localizeProviderAvailability<Availability extends ProviderAvailability>(
  availability: Availability,
  t: TranslateFn,
): Omit<Availability, 'diagnostic'> {
  const { diagnostic, ...result } = availability
  if (availability.available) return result

  const params = diagnostic?.params
  let reason: string
  switch (diagnostic?.key) {
    case 'missingKey':
      reason = t('search.settings.providers.diagnostics.missingKey', 'Set {envKey} to enable {provider}', params)
      break
    case 'unknownProvider':
      reason = t('search.settings.providers.diagnostics.unknownProvider', 'Unknown provider: {provider}', params)
      break
    case 'ollamaResponse':
      reason = t('search.settings.providers.diagnostics.ollamaResponse', 'Ollama responded {status} at {baseUrl}', params)
      break
    case 'ollamaTimeout':
      reason = t('search.settings.providers.diagnostics.ollamaTimeout', 'Ollama not reachable at {baseUrl} (timed out)', params)
      break
    case 'ollamaUnreachable':
      reason = t('search.settings.providers.diagnostics.ollamaUnreachable', 'Ollama not reachable at {baseUrl}', params)
      break
    default:
      reason = t('search.settings.providers.diagnostics.unavailable', 'Provider availability check failed')
  }
  return { ...result, reason }
}
