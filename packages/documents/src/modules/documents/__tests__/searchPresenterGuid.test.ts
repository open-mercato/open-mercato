jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

import { searchConfig } from '../search'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'

describe('documents search result presenter', () => {
  it('uses a localized generic label instead of exposing an id when title is absent', async () => {
    const presenter = await searchConfig.entities[0]?.formatResult?.({
      record: { id: DOCUMENT_ID, title: null },
    } as never)

    expect(presenter?.title).toBe('Document')
    expect(JSON.stringify(presenter)).not.toContain(DOCUMENT_ID)
  })
})
