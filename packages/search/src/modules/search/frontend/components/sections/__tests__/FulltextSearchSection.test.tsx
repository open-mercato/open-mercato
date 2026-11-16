/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { FulltextSearchSection } from '../FulltextSearchSection'
import polishTranslations from '../../../../i18n/pl.json'

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ useAppEvent: jest.fn() }))

it('renders Polish environment help even when the API returns English hints', () => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: jest.fn(() => new Promise(() => undefined)),
  })
  render(
    <I18nProvider locale="pl" dict={polishTranslations}>
      <FulltextSearchSection
        fulltextConfig={{
          driver: null,
          configured: false,
          envVars: {
            MEILISEARCH_HOST: { set: false, hint: 'The URL of your Meilisearch server' },
            MEILISEARCH_API_KEY: { set: false, hint: 'API key for authentication with Meilisearch' },
          },
          optionalEnvVars: {
            MEILISEARCH_INDEX_PREFIX: { set: false, hint: 'Prefix for index names', default: 'om' },
            SEARCH_EXCLUDE_ENCRYPTED_FIELDS: { set: false, hint: 'Exclude encrypted fields', default: true },
          },
        }}
        fulltextConfigLoading={false}
        fulltextStats={null}
        fulltextReindexLock={null}
        loading={false}
        onStatsUpdate={jest.fn()}
        onRefresh={jest.fn().mockResolvedValue(undefined)}
      />
    </I18nProvider>,
  )

  for (const key of ['host', 'apiKey', 'indexPrefix', 'excludeEncrypted']) {
    expect(screen.getByText(polishTranslations[`search.settings.fulltext.hints.${key}` as keyof typeof polishTranslations])).toBeTruthy()
  }
  expect(screen.queryByText('API key for authentication with Meilisearch')).toBeNull()
})
