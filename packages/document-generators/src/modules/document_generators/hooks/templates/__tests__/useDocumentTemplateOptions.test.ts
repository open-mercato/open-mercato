const readApiResultOrThrow = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrow(...args),
}))

import {
  documentTemplateOptionsQueryKey,
  fetchDocumentTemplateOptions,
} from '../useDocumentTemplateOptions'

describe('document template filter options query', () => {
  beforeEach(() => {
    readApiResultOrThrow.mockReset()
  })

  it('uses a dedicated cache key and options endpoint', async () => {
    const signal = new AbortController().signal
    const response = {
      resourceKinds: ['example.record'],
      formats: ['pdf'],
    }
    readApiResultOrThrow.mockResolvedValue(response)

    await expect(fetchDocumentTemplateOptions(signal)).resolves.toEqual(response)
    expect(documentTemplateOptionsQueryKey).toEqual(['document-generators', 'templates', 'options'])
    expect(readApiResultOrThrow).toHaveBeenCalledWith(
      '/api/document-generators/templates/options',
      { signal },
      { errorMessage: '[internal] Failed to load document template filter options' },
    )
  })
})
