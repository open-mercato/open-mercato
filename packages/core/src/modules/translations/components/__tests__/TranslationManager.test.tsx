/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { QueryClient } from '@tanstack/react-query'
import polishTranslations from '../../i18n/pl.json'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { registerTranslatableFields } from '@open-mercato/shared/lib/localization/translatable-fields'
import { TranslationManager, LocaleManager } from '../TranslationManager'
import translatableFields from '../../../catalog/translations'

const apiCallMock = jest.fn()
const withScopedApiRequestHeadersMock = jest.fn(
  async (_headers: unknown, operation: () => Promise<unknown>) => operation(),
)
const buildOptimisticLockHeaderMock = jest.fn((updatedAt?: string) => ({
  'x-om-ext-optimistic-lock-expected-updated-at': updatedAt ?? '',
}))
const runMutationMock = jest.fn(
  async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
)
const retryLastMutationMock = jest.fn(async () => true)
const flashMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
  withScopedApiRequestHeaders: (...args: [unknown, () => Promise<unknown>]) =>
    withScopedApiRequestHeadersMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/optimisticLock'),
  buildOptimisticLockHeader: (...args: [string | undefined]) => buildOptimisticLockHeaderMock(...args),
}))

const surfaceRecordConflictMock = jest.fn((..._args: unknown[]) => false)

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: runMutationMock,
    retryLastMutation: retryLastMutationMock,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  useCustomFieldDefs: () => ({ data: [], isLoading: false }),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  ComboboxInput: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }) => (
    <input
      aria-label="combobox"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

beforeEach(() => {
  jest.clearAllMocks()
  apiCallMock.mockImplementation(
    async (url: string, init?: { method?: string; body?: string }) => {
      if (!init?.method) {
        if (url === '/api/translations/locales') {
          return { ok: true, result: { locales: ['en', 'de'], servable: ['en', 'de'] } }
        }
        // entity-translation GET
        return {
          ok: true,
          result: {
            entityType: 'catalog:product',
            entityId: 'rec-1',
            translations: {},
            updatedAt: '2026-01-02T00:00:00Z',
          },
        }
      }
      // mutating writes (PUT)
      const parsed = init.body ? JSON.parse(init.body) : {}
      return { ok: true, result: { locales: parsed.locales ?? [] } }
    },
  )
})

describe('TranslationManager guarded mutations (#3316)', () => {
  it('routes the entity-translation save through useGuardedMutation, not a raw mutation', async () => {
    renderWithProviders(
      <TranslationManager
        mode="embedded"
        entityType="catalog:product"
        recordId="rec-1"
        baseValues={{ name: 'Base name' }}
        translatableFields={['name']}
      />,
    )

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'Nazwa testowa' } })

    fireEvent.click(screen.getByTestId('translations-save'))

    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))

    const runInput = runMutationMock.mock.calls[0][0] as {
      context: Record<string, unknown>
      mutationPayload?: Record<string, unknown>
    }
    expect(runInput.context).toMatchObject({ entityType: 'catalog:product', recordId: 'rec-1' })
    // the conflict-resolution retry handle MUST be carried in the injection context
    expect(runInput.context.retryLastMutation).toBe(retryLastMutationMock)
    expect(runInput.mutationPayload).toEqual({ en: { name: 'Nazwa testowa' } })

    // optimistic-lock header is still built + applied on the guarded write
    await waitFor(() =>
      expect(buildOptimisticLockHeaderMock).toHaveBeenCalledWith('2026-01-02T00:00:00Z'),
    )
    expect(withScopedApiRequestHeadersMock).toHaveBeenCalled()
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/translations/catalog%3Aproduct/rec-1',
      expect.objectContaining({ method: 'PUT' }),
    )

    // flash behavior preserved
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Translations saved', 'success'))
  })

  function renderEmbeddedProductEditor() {
    renderWithProviders(
      <TranslationManager
        mode="embedded"
        entityType="catalog:product"
        recordId="rec-1"
        baseValues={{ name: 'Base name' }}
        translatableFields={['name']}
      />,
    )
  }

  it('checks the opening scope again immediately before sending a guarded save', async () => {
    document.cookie = 'om_selected_org=original-organization; path=/'
    runMutationMock.mockImplementationOnce(async ({ operation }) => {
      document.cookie = 'om_selected_org=__all__; path=/'
      return operation()
    })
    try {
      renderEmbeddedProductEditor()
      const input = await screen.findByRole('textbox')
      fireEvent.change(input, { target: { value: 'Old-scope draft' } })
      fireEvent.click(screen.getByTestId('translations-save'))

      await waitFor(() => expect(flashMock).toHaveBeenCalledWith(
        'The organization selection changed. Close and reopen the translation editor to continue.',
        'error',
      ))
      expect(apiCallMock).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PUT' }),
      )
      expect(input).toHaveValue('Old-scope draft')

      document.cookie = 'om_selected_org=original-organization; path=/'
      fireEvent.click(screen.getByTestId('translations-save'))
      await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Translations saved', 'success'))
    } finally {
      document.cookie = 'om_selected_org=; Max-Age=0; path=/'
    }
  })

  function failTranslationSaveWith(status: number, body: Record<string, unknown>) {
    const defaultImplementation = apiCallMock.getMockImplementation()
    apiCallMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT' && url.startsWith('/api/translations/catalog')) {
        return { ok: false, status, result: body, response: new Response(JSON.stringify(body), { status }) }
      }
      return defaultImplementation?.(url, init)
    })
  }

  it('hands a 409 optimistic-lock conflict to the shared conflict surface', async () => {
    surfaceRecordConflictMock.mockReturnValueOnce(true)
    failTranslationSaveWith(409, {
      error: 'Record modified',
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: '2026-01-03T00:00:00Z',
      expectedUpdatedAt: '2026-01-02T00:00:00Z',
    })
    renderEmbeddedProductEditor()

    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Nazwa testowa' } })
    fireEvent.click(screen.getByTestId('translations-save'))

    await waitFor(() => expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1))
    const [error] = surfaceRecordConflictMock.mock.calls[0] as [Record<string, unknown>]
    expect(error).toMatchObject({ status: 409, code: 'optimistic_lock_conflict' })
    expect(flashMock).not.toHaveBeenCalledWith(expect.anything(), 'error')
  })

  it('shows the server rejection message instead of a generic save failure', async () => {
    failTranslationSaveWith(400, { error: 'Invalid payload.', code: 'unregistered_translation_field' })
    renderEmbeddedProductEditor()

    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Nazwa testowa' } })
    fireEvent.click(screen.getByTestId('translations-save'))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Invalid payload.', 'error'))
  })

  it('serializes same-tick Save clicks and keyboard submission until the saved version reloads', async () => {
    const original = apiCallMock.getMockImplementation()
    let releaseWrite: (() => void) | undefined
    const write = new Promise<void>((resolve) => { releaseWrite = resolve })
    apiCallMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT') {
        await write
        return { ok: true, result: {} }
      }
      return original?.(url, init)
    })
    renderEmbeddedProductEditor()
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Translated name' } })
    const save = screen.getByTestId('translations-save')
    act(() => {
      fireEvent.click(save)
      fireEvent.click(save)
      fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    })
    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))
    await act(async () => { releaseWrite?.() })
    await waitFor(() => expect(save).toHaveTextContent('Save translations'))
    expect(save).toBeDisabled()
    fireEvent.click(save)
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    expect(runMutationMock).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Another translation' } })
    fireEvent.click(save)
    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(2))
  })

  it('blocks writes after a failed translation load and recovers through Retry', async () => {
    const original = apiCallMock.getMockImplementation()
    let loadFails = true
    apiCallMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (!init?.method && url.startsWith('/api/translations/catalog') && loadFails) {
        return { ok: false, response: new Response('{}', { status: 503 }) }
      }
      return original?.(url, init)
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderWithProviders(<TranslationManager mode="embedded" entityType="catalog:product" recordId="rec-1" translatableFields={['name']} />, { queryClient })
    expect(await screen.findByText('Failed to load translations')).toBeVisible()
    expect(screen.getByTestId('translations-save')).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    expect(runMutationMock).not.toHaveBeenCalled()
    loadFails = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('textbox')).toBeVisible()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Recovered translation' } })
    await waitFor(() => expect(screen.getByTestId('translations-save')).not.toBeDisabled())
  })

  it('localizes built-in property captions in Polish without translating stored values', async () => {
    renderWithProviders(
      <TranslationManager mode="embedded" entityType="entities:custom_field_def" recordId="field-1" baseValues={{ label: 'Custom caption', description: 'Custom help' }} translatableFields={['label', 'description']} />,
      { locale: 'pl', dict: polishTranslations },
    )
    expect(await screen.findByRole('cell', { name: 'Etykieta', exact: true })).toBeVisible()
    expect(screen.getByRole('cell', { name: 'Opis', exact: true })).toBeVisible()
    expect(screen.getByText('Custom caption')).toBeVisible()
    expect(screen.getByText('Custom help')).toBeVisible()
  })

})

describe('LocaleManager guarded mutations (#3316)', () => {
  it('routes the supported-locales save through useGuardedMutation, not a raw mutation', async () => {
    renderWithProviders(<LocaleManager />)

    await screen.findByRole('button', { name: 'Add' })

    // click a locale remove "X" button -> removeLocale -> guarded save.
    // German, not English: the default locale is always served, so its remove
    // control is deliberately disabled.
    fireEvent.click(screen.getByRole('button', { name: 'Remove German' }))

    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))

    const runInput = runMutationMock.mock.calls[0][0] as {
      context: Record<string, unknown>
      mutationPayload?: Record<string, unknown>
    }
    expect(runInput.context.retryLastMutation).toBe(retryLastMutationMock)
    expect(runInput.mutationPayload).toEqual({ locales: ['en'] })
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/translations/locales',
      expect.objectContaining({ method: 'PUT' }),
    )

    // flash behavior preserved
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Locales updated', 'success'))
  })
})

describe('TranslationManager standalone record loading for option schema templates', () => {
  const templateId = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => {
    registerTranslatableFields(translatableFields)
    apiCallMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method) return { ok: true, result: {} }
      if (url === '/api/translations/locales') {
        return { ok: true, result: { locales: ['en', 'de'], servable: ['en', 'de'] } }
      }
      if (url.startsWith('/api/catalog/option-schemas?')) {
        return {
          ok: true,
          result: {
            items: [
              {
                id: templateId,
                name: 'Apparel options',
                schema: {
                  options: [
                    { code: 'color', label: 'Color', choices: [{ code: 'red', label: 'Red' }] },
                  ],
                },
              },
            ],
          },
        }
      }
      return { ok: true, result: { entityType: 'catalog:catalog_option_schema_template', entityId: templateId, translations: {} } }
    })
  })

  it('loads the record from the registered list route and renders option and choice rows with base values', async () => {
    renderWithProviders(
      <TranslationManager entityType="catalog:catalog_option_schema_template" recordId={templateId} />,
    )

    expect(await screen.findByText('Color › Red')).toBeTruthy()
    expect(screen.getAllByText('Color')).toHaveLength(2)
    expect(screen.getByText('Red')).toBeTruthy()

    const requestedUrls = apiCallMock.mock.calls.map((call) => String(call[0]))
    expect(requestedUrls.some((url) => url.startsWith(`/api/catalog/option-schemas?id=${templateId}`))).toBe(true)
    expect(requestedUrls.some((url) => url.includes('option-schema-templates'))).toBe(false)
  })
})
