import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import polish from '../../../../i18n/pl.json'
import { localizeAdapterDetail } from '../adapterDetail'

const translate = createTranslator(polish)

describe('web-search provider readiness translations', () => {
  it.each(['Exa', 'Firecrawl', 'Tavily'])('uses the Polish dictionary for missing %s credentials', (provider) => {
    expect(localizeAdapterDetail(`${provider} API key is not set`, translate)).toBe(`Nie ustawiono klucza API dostawcy ${provider}`)
  })

  it('translates missing SearXNG URL, search engines and model resolver', () => {
    expect(localizeAdapterDetail('SearXNG base URL is not set', translate)).toBe('Nie ustawiono bazowego adresu URL dostawcy SearXNG')
    expect(localizeAdapterDetail('no search engines are enabled', translate)).toBe(polish['agent_orchestrator.settings.webSearch.noSearchEngines'])
    expect(localizeAdapterDetail('no model resolver was provided by the host application', translate)).toBe(polish['agent_orchestrator.settings.webSearch.noModelResolver'])
  })

  it('preserves unknown third-party diagnostics and empty details', () => {
    expect(localizeAdapterDetail('Custom adapter is offline', translate)).toBe('Custom adapter is offline')
    expect(localizeAdapterDetail(null, translate)).toBeNull()
  })
})
