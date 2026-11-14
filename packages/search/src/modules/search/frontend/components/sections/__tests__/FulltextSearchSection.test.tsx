/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import {
  FulltextSearchSection,
  type FulltextSearchSectionProps,
} from '../FulltextSearchSection'

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: jest.fn(),
}))

const flashMock = jest.fn()

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

const fulltextConfig: NonNullable<FulltextSearchSectionProps['fulltextConfig']> = {
  driver: 'meilisearch',
  configured: true,
  envVars: {
    MEILISEARCH_HOST: { set: true, hint: '' },
    MEILISEARCH_API_KEY: { set: true, hint: '' },
  },
  optionalEnvVars: {
    MEILISEARCH_INDEX_PREFIX: { set: false, hint: '' },
    SEARCH_EXCLUDE_ENCRYPTED_FIELDS: { set: false, hint: '' },
  },
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
}

function mockFetch(reindexBody: unknown) {
  const fetchMock = jest.fn((url: string) => {
    if (url === '/api/search/reindex') return jsonResponse(reindexBody)
    return jsonResponse({ logs: [], errors: [] })
  })
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock })
  return fetchMock
}

async function runFullReindex() {
  const onRefresh = jest.fn().mockResolvedValue(undefined)
  render(
    <I18nProvider locale="en" dict={{}}>
      <FulltextSearchSection
        fulltextConfig={fulltextConfig}
        fulltextConfigLoading={false}
        fulltextStats={null}
        fulltextReindexLock={null}
        loading={false}
        onStatsUpdate={jest.fn()}
        onRefresh={onRefresh}
      />
    </I18nProvider>,
  )
  fireEvent.click(screen.getByRole('tab', { name: 'Index Management' }))
  fireEvent.click(screen.getByRole('button', { name: 'Full Reindex' }))
  const confirmButtons = screen.getAllByRole('button', { name: 'Full Reindex' })
  fireEvent.click(confirmButtons[confirmButtons.length - 1])
  await waitFor(() => expect(flashMock).toHaveBeenCalled())
  return { onRefresh }
}

describe('FulltextSearchSection full reindex result', () => {
  beforeEach(() => {
    flashMock.mockReset()
  })

  it('flashes the localized route error instead of success when the reindex is not ok', async () => {
    mockFetch({
      ok: false,
      error: 'Reindex did not complete. Check the search activity log for details.',
      action: 'reindex',
      entityId: null,
      useQueue: true,
      result: {
        entitiesProcessed: 0,
        recordsIndexed: 0,
        jobsEnqueued: 0,
        errors: [{ entityId: 'all', error: 'Fulltext driver "algolia" cannot clear documents per entity (implement purge or listDocumentIds)' }],
      },
    })

    const { onRefresh } = await runFullReindex()

    expect(flashMock).toHaveBeenCalledTimes(1)
    expect(flashMock).toHaveBeenCalledWith('Reindex did not complete. Check the search activity log for details.', 'error')
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('falls back to the localized reindex error when ok is false without a message', async () => {
    mockFetch({ ok: false, action: 'reindex', entityId: null, result: { entitiesProcessed: 0, recordsIndexed: 0 } })

    await runFullReindex()

    expect(flashMock).toHaveBeenCalledWith('Failed to reindex', 'error')
  })

  it('flashes success when the reindex is ok', async () => {
    mockFetch({ ok: true, action: 'reindex', entityId: null, result: { entitiesProcessed: 1, recordsIndexed: 3 } })

    const { onRefresh } = await runFullReindex()

    expect(flashMock).toHaveBeenCalledWith('Operation completed successfully: 3 documents indexed', 'success')
    expect(onRefresh).toHaveBeenCalled()
  })
})
