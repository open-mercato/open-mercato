import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export function localizeAdapterDetail(detail: string | null, translate: TranslateFn): string | null {
  const missingKey = /^(Tavily|Firecrawl|Exa) API key is not set$/.exec(detail ?? '')
  if (missingKey) {
    return translate('agent_orchestrator.settings.webSearch.apiKeyMissing', { provider: missingKey[1] })
  }
  if (detail === 'SearXNG base URL is not set') {
    return translate('agent_orchestrator.settings.webSearch.baseUrlMissing', { provider: 'SearXNG' })
  }
  if (detail === 'no search engines are enabled') {
    return translate('agent_orchestrator.settings.webSearch.noSearchEngines')
  }
  if (detail === 'no model resolver was provided by the host application') {
    return translate('agent_orchestrator.settings.webSearch.noModelResolver')
  }
  return detail
}
