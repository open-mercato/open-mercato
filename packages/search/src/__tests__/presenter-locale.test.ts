jest.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'locale' ? { value: 'pl' } : undefined) }),
  headers: async () => ({ get: () => '' }),
}))

import type { Kysely } from 'kysely'
import { createPresenterEnricher } from '../lib/presenter-enricher'
import { registerModules, resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { Module } from '@open-mercato/shared/modules/registry'
import type { SearchEntityConfig, SearchResult } from '../types'

const DEMO_ENTITY_ID = 'demo:thing' as EntityId

function makeDbReturning(rows: Array<{ entity_type: string; entity_id: string; doc: Record<string, unknown> }>) {
  const chain = {
    selectFrom: () => chain,
    select: () => chain,
    where: () => chain,
    execute: async () => rows,
  }
  return chain as unknown as Kysely<Record<string, never>>
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
      },
    ] satisfies Module[])
  })

  it('renders the presenter badge and link label in the request locale (pl)', async () => {
    const { locale, t } = await resolveTranslations()
    expect(locale).toBe('pl')
    expect(t('demo.search.badge', 'Person')).toBe('Osoba')

    const config: SearchEntityConfig = {
      entityId: DEMO_ENTITY_ID,
      enabled: true,
      formatResult: async () => {
        const { t: translate } = await resolveTranslations()
        return { title: 'Ada', badge: translate('demo.search.badge', 'Person') }
      },
      resolveLinks: async () => {
        const { t: translate } = await resolveTranslations()
        return [{ href: '/x', label: translate('demo.search.link.open', 'Open person') }]
      },
    }

    const entityConfigMap = new Map<EntityId, SearchEntityConfig>([[DEMO_ENTITY_ID, config]])
    const db = makeDbReturning([
      { entity_type: 'demo:thing', entity_id: 'rec-1', doc: { id: 'rec-1', display_name: 'Ada' } },
    ])

    const enrich = createPresenterEnricher(db, entityConfigMap)
    const results: SearchResult[] = [{
      entityId: DEMO_ENTITY_ID,
      recordId: 'rec-1',
      score: 1,
      source: 'fulltext',
      presenter: { title: 'Ada', badge: 'Person' },
      links: [{ href: '/x', label: 'Open person', kind: 'primary' }],
    }]

    const [enriched] = await enrich(results, 'tenant-1', null)

    expect(enriched.presenter?.badge).toBe('Osoba')
    expect(enriched.links?.[0]?.label).toBe('Otwórz osobę')
  })
})
