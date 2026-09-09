/**
 * @jest-environment jsdom
 *
 * Regression coverage for issue #3318: locale selection and locale removal in
 * TranslationManager/LocaleManager must use shared UI primitives (semantic
 * `Tabs` triggers and `IconButton`) instead of raw `<button>` elements, and the
 * remove affordance must expose an accessible label.
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockUseQuery = jest.fn()
const mockUseMutation = jest.fn()
const mockUseQueryClient = jest.fn()

jest.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQueryClient: () => mockUseQueryClient(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  useCustomFieldDefs: () => ({ data: [], isLoading: false }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  ComboboxInput: () => <div data-testid="combobox" />,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('../../lib/resolve-field-list', () => ({
  resolveFieldList: () => [],
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (
    key: string,
    fallbackOrParams?: string | Record<string, unknown>,
    params?: Record<string, unknown>,
  ) => {
    let fallback: string | undefined
    let resolvedParams: Record<string, unknown> | undefined
    if (typeof fallbackOrParams === 'string') {
      fallback = fallbackOrParams
      resolvedParams = params
    } else {
      resolvedParams = fallbackOrParams ?? params
    }
    const template = fallback ?? key
    if (!resolvedParams) return template
    return template.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (match, doubleKey, singleKey) => {
      const token = doubleKey ?? singleKey
      const value = resolvedParams![token]
      return value !== undefined ? String(value) : match
    })
  }
  return { useT: () => translate }
})

import { TranslationManager, LocaleManager } from '../TranslationManager'

describe('TranslationManager locale tabs (issue #3318)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: jest.fn(),
    })
    mockUseMutation.mockReturnValue({ mutate: jest.fn(), isPending: false })
    mockUseQueryClient.mockReturnValue({ setQueryData: jest.fn(), invalidateQueries: jest.fn() })
  })

  it('renders locale tabs as semantic Tabs primitives, not raw buttons', () => {
    render(<TranslationManager mode="embedded" entityType="" recordId="" />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['EN', 'PL', 'ES', 'DE', 'KO'])
    // Proves the shared Tabs primitive is rendering the triggers (not a hand-rolled <button>).
    tabs.forEach((tab) => expect(tab).toHaveAttribute('data-slot', 'tabs-trigger'))
  })

  it('marks the clicked locale tab active and the previous one inactive', async () => {
    render(<TranslationManager mode="embedded" entityType="" recordId="" />)

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'EN' })).toHaveAttribute('data-state', 'active'),
    )

    fireEvent.click(screen.getByRole('tab', { name: 'PL' }))

    expect(screen.getByRole('tab', { name: 'PL' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('tab', { name: 'EN' })).toHaveAttribute('data-state', 'inactive')
  })
})

describe('LocaleManager remove affordance (issue #3318)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseMutation.mockReturnValue({ mutate: jest.fn(), isPending: false })
    mockUseQueryClient.mockReturnValue({ setQueryData: jest.fn(), invalidateQueries: jest.fn() })
  })

  it('renders an accessible IconButton per removable locale and removes it on click', () => {
    const mutate = jest.fn()
    mockUseMutation.mockReturnValue({ mutate, isPending: false })
    mockUseQuery.mockReturnValue({ data: { locales: ['en', 'de', 'fr'], servable: ['en', 'de'] }, isLoading: false })

    render(<LocaleManager />)

    const removeGerman = screen.getByRole('button', { name: 'Remove German' })
    // IconButton renders a real <button> primitive with an accessible label.
    expect(removeGerman).toHaveAttribute('data-slot', 'icon-button')

    fireEvent.click(removeGerman)

    expect(mutate).toHaveBeenCalledWith(['en', 'fr'])
  })

  it('does not render a remove affordance when only one locale remains', () => {
    mockUseQuery.mockReturnValue({ data: { locales: ['en'], servable: ['en'] }, isLoading: false })

    render(<LocaleManager />)

    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
  })
})

/**
 * The stored selection drives two different things: which languages content can
 * be translated into (any ISO 639-1 code) and which of those the admin UI can be
 * shown in (only the ones the app ships a dictionary for). Adding a code with no
 * dictionary used to look like it did both. UX findings 2 and 3.
 */
describe('LocaleManager honesty about what a locale actually does', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseMutation.mockReturnValue({ mutate: jest.fn(), isPending: false })
    mockUseQueryClient.mockReturnValue({ setQueryData: jest.fn(), invalidateQueries: jest.fn() })
  })

  it('marks a locale the app cannot serve its own UI in as content only', () => {
    mockUseQuery.mockReturnValue({
      data: { locales: ['en', 'de', 'fr'], servable: ['en', 'de'] },
      isLoading: false,
    })

    render(<LocaleManager />)

    // One qualifier, on `fr` — the code with no UI dictionary behind it.
    const qualifiers = screen.getAllByText('Content only')
    expect(qualifiers).toHaveLength(1)
    expect(qualifiers[0].closest('span')?.textContent).toContain('FR')
  })

  it('does not qualify a locale the app can serve', () => {
    mockUseQuery.mockReturnValue({
      data: { locales: ['en', 'de'], servable: ['en', 'de'] },
      isLoading: false,
    })

    render(<LocaleManager />)

    expect(screen.queryByText('Content only')).toBeNull()
  })

  it('refuses to remove the default locale, which stays served whatever is saved', () => {
    const mutate = jest.fn()
    mockUseMutation.mockReturnValue({ mutate, isPending: false })
    mockUseQuery.mockReturnValue({
      data: { locales: ['en', 'de'], servable: ['en', 'de'] },
      isLoading: false,
    })

    render(<LocaleManager />)

    const removeEnglish = screen.getByRole('button', {
      name: 'English is the default language and is always served, so it cannot be removed.',
    })
    expect(removeEnglish).toBeDisabled()

    fireEvent.click(removeEnglish)
    expect(mutate).not.toHaveBeenCalled()

    // Every other locale stays removable.
    fireEvent.click(screen.getByRole('button', { name: 'Remove German' }))
    expect(mutate).toHaveBeenCalledWith(['en'])
  })
})
