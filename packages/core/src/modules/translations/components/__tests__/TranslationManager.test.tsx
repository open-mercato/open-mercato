/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TranslationManager, LocaleManager } from '../TranslationManager'

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
  buildOptimisticLockHeader: (...args: [string | undefined]) => buildOptimisticLockHeaderMock(...args),
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
          return { ok: true, result: { locales: ['en', 'de'] } }
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
})

describe('LocaleManager guarded mutations (#3316)', () => {
  it('routes the supported-locales save through useGuardedMutation, not a raw mutation', async () => {
    renderWithProviders(<LocaleManager />)

    await screen.findByRole('button', { name: 'Add' })

    // click a locale remove "X" button -> removeLocale -> guarded save
    const removeButton = screen
      .getAllByRole('button')
      .find((button) => !/add/i.test(button.textContent || ''))
    expect(removeButton).toBeDefined()
    fireEvent.click(removeButton as HTMLElement)

    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))

    const runInput = runMutationMock.mock.calls[0][0] as {
      context: Record<string, unknown>
      mutationPayload?: Record<string, unknown>
    }
    expect(runInput.context.retryLastMutation).toBe(retryLastMutationMock)
    expect(runInput.mutationPayload).toEqual({ locales: ['de'] })
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/translations/locales',
      expect.objectContaining({ method: 'PUT' }),
    )

    // flash behavior preserved
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Locales updated', 'success'))
  })
})
