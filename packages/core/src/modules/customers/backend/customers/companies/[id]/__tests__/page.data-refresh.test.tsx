/**
 * @jest-environment jsdom
 */

// Regression coverage for issue #7205: marking an activity done on the legacy
// company page must refresh the company overview (e.g. the Next interaction
// tile) without a reload and without dropping the page back to its spinner.

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
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

jest.mock('../../../../../components/detail/ActivitiesSection', () => ({
  ActivitiesSection: ({ onDataRefresh }: { onDataRefresh?: () => void | Promise<void> }) => (
    <button type="button" data-testid="activities-refresh" onClick={() => { void onDataRefresh?.() }}>
      refresh
    </button>
  ),
}))
jest.mock('../../../../../components/detail/TagsSection', () => ({ TagsSection: () => null }))
jest.mock('../../../../../components/detail/DealsSection', () => ({ DealsSection: () => null }))
jest.mock('../../../../../components/detail/AddressesSection', () => ({ AddressesSection: () => null }))
jest.mock('../../../../../components/detail/TasksSection', () => ({ TasksSection: () => null }))
jest.mock('../../../../../components/detail/CustomDataSection', () => ({ CustomDataSection: () => null }))
jest.mock('../../../../../components/detail/CompanyHighlights', () => ({
  CompanyHighlights: ({ company }: { company: { nextInteractionName?: string | null } }) => (
    <div data-testid="next-interaction">{company.nextInteractionName ?? ''}</div>
  ),
}))
jest.mock('../../../../../components/detail/CompanyPeopleSection', () => ({ CompanyPeopleSection: () => null }))
jest.mock('../../../../../components/detail/AnnualRevenueField', () => ({ AnnualRevenueField: () => null }))
jest.mock('../../../../../components/detail/DetailTabsLayout', () => ({
  DetailTabsLayout: ({
    tabs,
    onTabChange,
    sectionAction,
    children,
  }: {
    tabs: Array<{ id: string; label: string }>
    onTabChange: (id: string) => void
    sectionAction: { label: string } | null
    children: React.ReactNode
  }) => (
    <div>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" data-testid={`tab-${tab.id}`} onClick={() => onTabChange(tab.id)}>
          {tab.label}
        </button>
      ))}
      {sectionAction ? <button type="button" data-testid="section-action">{sectionAction.label}</button> : null}
      {children}
    </div>
  ),
}))
jest.mock('../../../../../components/detail/InlineEditors', () => ({
  renderMultilineMarkdownDisplay: () => null,
  InlineDictionaryEditor: () => null,
}))

const companyId = '2408107d-0000-4000-8000-000000000001'

function overview(nextInteractionName: string) {
  return {
    company: { id: companyId, displayName: 'Harborview Analytics', nextInteractionName },
    profile: null,
    customFields: {},
    tags: [],
    addresses: [],
    comments: [],
    activities: [],
    deals: [],
    todos: [],
    people: [],
  }
}

describe('CustomerCompanyDetailPage — refresh after activity changes (#7205)', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
  })

  it('refetches the overview when the Activities section requests a refresh', async () => {
    readApiResultOrThrowMock
      .mockResolvedValueOnce(overview('Call A'))
      .mockResolvedValueOnce(overview('Call B'))
    renderWithProviders(<CompanyDetailPage params={{ id: companyId }} />)

    expect(await screen.findByTestId('next-interaction')).toHaveTextContent('Call A')
    fireEvent.click(screen.getByTestId('tab-activities'))
    fireEvent.click(await screen.findByTestId('activities-refresh'))

    await waitFor(() => {
      expect(screen.getByTestId('next-interaction')).toHaveTextContent('Call B')
    })
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
    expect(readApiResultOrThrowMock.mock.calls[1][0]).toContain(`/api/customers/companies/${companyId}`)
    expect(screen.queryByText('spinner')).not.toBeInTheDocument()
    // The Activities tab stays mounted, so unsaved inline drafts survive.
    expect(screen.getByTestId('activities-refresh')).toBeInTheDocument()
  })

  it('keeps the current overview when the refresh fails', async () => {
    readApiResultOrThrowMock
      .mockResolvedValueOnce(overview('Call A'))
      .mockRejectedValueOnce(Object.assign(new Error('Network down'), { status: 500 }))
    renderWithProviders(<CompanyDetailPage params={{ id: companyId }} />)

    expect(await screen.findByTestId('next-interaction')).toHaveTextContent('Call A')
    fireEvent.click(screen.getByTestId('tab-activities'))
    fireEvent.click(await screen.findByTestId('activities-refresh'))

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByTestId('next-interaction')).toHaveTextContent('Call A')
    expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
  })

  it.each([
    ['fails', Object.assign(new Error('Server exploded'), { status: 500 }), 'error-message'],
    ['is not found', Object.assign(new Error('Not found'), { status: 404 }), 'record-not-found'],
  ])('shows the original company again after another company %s', async (_label, failure, failureTestId) => {
    const otherCompanyId = '2408107d-0000-4000-8000-000000000002'
    readApiResultOrThrowMock
      .mockResolvedValueOnce(overview('Call A'))
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(overview('Call A again'))
    const { rerender } = renderWithProviders(<CompanyDetailPage params={{ id: companyId }} />)
    expect(await screen.findByTestId('next-interaction')).toHaveTextContent('Call A')

    rerender(<CompanyDetailPage params={{ id: otherCompanyId }} />)
    expect(await screen.findByTestId(failureTestId)).toBeInTheDocument()

    rerender(<CompanyDetailPage params={{ id: companyId }} />)
    await waitFor(() => {
      expect(screen.getByTestId('next-interaction')).toHaveTextContent('Call A again')
    })
    expect(screen.queryByTestId(failureTestId)).not.toBeInTheDocument()
  })
})
