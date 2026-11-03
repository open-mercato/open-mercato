/**
 * @jest-environment jsdom
 */

// Regression coverage for issue #6158: opening the company detail page with a
// malformed id must show the same localized not-found state as a well-formed
// but missing id — never the raw, untranslated server error text.

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import CompanyDetailPage from '../page'

const readApiResultOrThrowMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/backend/customers/companies/test',
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/separator', () => ({
  Separator: () => null,
}))

jest.mock('@open-mercato/ui/primitives/spinner', () => ({
  Spinner: () => <div>spinner</div>,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  NotesSection: () => null,
  RecordNotFoundState: ({ label }: { label: string }) => <div data-testid="record-not-found">{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div data-testid="error-message">{label}</div>,
  DetailFieldsSection: () => null,
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [] }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/messages', () => ({
  SendObjectMessageDialog: () => null,
}))

jest.mock('../../../../../components/detail/ActivitiesSection', () => ({ ActivitiesSection: () => null }))
jest.mock('../../../../../components/detail/TagsSection', () => ({ TagsSection: () => null }))
jest.mock('../../../../../components/detail/DealsSection', () => ({ DealsSection: () => null }))
jest.mock('../../../../../components/detail/AddressesSection', () => ({ AddressesSection: () => null }))
jest.mock('../../../../../components/detail/TasksSection', () => ({ TasksSection: () => null }))
jest.mock('../../../../../components/detail/CustomDataSection', () => ({ CustomDataSection: () => null }))
jest.mock('../../../../../components/detail/CompanyHighlights', () => ({ CompanyHighlights: () => null }))
jest.mock('../../../../../components/detail/CompanyPeopleSection', () => ({ CompanyPeopleSection: () => null }))
jest.mock('../../../../../components/detail/AnnualRevenueField', () => ({ AnnualRevenueField: () => null }))
jest.mock('../../../../../components/detail/DetailTabsLayout', () => ({ DetailTabsLayout: () => null }))
jest.mock('../../../../../components/detail/InlineEditors', () => ({
  renderMultilineMarkdownDisplay: () => null,
  InlineDictionaryEditor: () => null,
}))

describe('CustomerCompanyDetailPage — malformed id handling (#6158)', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
  })

  it('shows the localized not-found state — not the raw server error text — when the id is malformed (400)', async () => {
    readApiResultOrThrowMock.mockRejectedValue(
      Object.assign(new Error('Invalid company id'), { status: 400 }),
    )

    renderWithProviders(<CompanyDetailPage params={{ id: 'not-a-valid-uuid' }} />)

    await waitFor(() => {
      expect(screen.getByTestId('record-not-found')).toBeInTheDocument()
    })
    expect(screen.getByTestId('record-not-found')).toHaveTextContent('Company not found')
    expect(screen.queryByText(/Invalid company id/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
  })

  it('still shows the not-found state for a well-formed but missing id (404)', async () => {
    readApiResultOrThrowMock.mockRejectedValue(
      Object.assign(new Error('Company not found'), { status: 404 }),
    )

    renderWithProviders(<CompanyDetailPage params={{ id: '2408107d-0000-4000-8000-000000000099' }} />)

    await waitFor(() => {
      expect(screen.getByTestId('record-not-found')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
  })

  it('keeps the generic error state for unexpected failures (500)', async () => {
    readApiResultOrThrowMock.mockRejectedValue(
      Object.assign(new Error('Boom'), { status: 500 }),
    )

    renderWithProviders(<CompanyDetailPage params={{ id: '2408107d-0000-4000-8000-000000000099' }} />)

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('record-not-found')).not.toBeInTheDocument()
  })
})
