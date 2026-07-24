/**
 * End-to-end (unit-level) coverage for request-time locale propagation:
 * a result that arrives with a frozen English presenter is re-rendered by the
 * presenter enricher in the request's locale, because the entity's config
 * `formatResult`/`resolveLinks` call `resolveTranslations()` which reads the
 * request locale and the registered module dictionary.
 *
 * The request locale is forced to `pl` by mocking the `locale` cookie that
 * `detectLocale()` reads from `next/headers`.
 */

jest.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'locale' ? { value: 'pl' } : undefined) }),
  headers: async () => ({ get: () => '' }),
}))

import { createPresenterEnricher } from '../lib/presenter-enricher'
import { registerModules, resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { SearchEntityConfig, SearchResult } from '../types'

function makeDbReturning(rows: Array<{ entity_type: string; entity_id: string; doc: Record<string, unknown> }>) {
  const chain: any = {
    selectFrom: () => chain,
    select: () => chain,
    where: () => chain,
    execute: async () => rows,
  }
  return chain
}

describe('request-time presenter localization', () => {
  beforeAll(() => {
    registerModules([
      {
        id: 'demo',
        translations: {
          en: { 'demo.search.badge': 'Person', 'demo.search.link.open': 'Open person' },
          pl: { 'demo.search.badge': 'Osoba', 'demo.search.link.open': 'Otwórz osobę' },
        },
      } as any,
    ])
  })

  it('renders the presenter badge and link label in the request locale (pl)', async () => {
    // sanity: the request locale resolves to pl with the registered dictionary
    const { locale, t } = await resolveTranslations()
    expect(locale).toBe('pl')
    expect(t('demo.search.badge', 'Person')).toBe('Osoba')

    const config: SearchEntityConfig = {
      entityId: 'demo:thing' as EntityId,
      enabled: true,
      formatResult: async () => {
        const { t: translate } = await resolveTranslations()
        return { title: 'Ada', badge: translate('demo.search.badge', 'Person') }
      },
      resolveLinks: async () => {
        const { t: translate } = await resolveTranslations()
        return [{ href: '/x', label: translate('demo.search.link.open', 'Open person') }]
      },
    } as any

    const entityConfigMap = new Map<EntityId, SearchEntityConfig>([['demo:thing' as EntityId, config]])
    const db = makeDbReturning([
      { entity_type: 'demo:thing', entity_id: 'rec-1', doc: { id: 'rec-1', display_name: 'Ada' } },
    ])

    const enrich = createPresenterEnricher(db as any, entityConfigMap)
    // Result arrives with a frozen English presenter (as a fulltext/vector hit would).
    const results: SearchResult[] = [{
      entityId: 'demo:thing' as EntityId,
      recordId: 'rec-1',
      score: 1,
      source: 'fulltext',
      presenter: { title: 'Ada', badge: 'Person' },
    }]

    const [enriched] = await enrich(results, 'tenant-1', null)

    expect(enriched.presenter?.badge).toBe('Osoba')
    expect(enriched.links?.[0]?.label).toBe('Otwórz osobę')
  })
})
