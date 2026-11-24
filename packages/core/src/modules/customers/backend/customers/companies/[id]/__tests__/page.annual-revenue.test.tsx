/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import CompanyDetailPage from '../page'

const readApiResultOrThrowMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const scopedHeadersMock = jest.fn((_headers: Record<string, string>, operation: () => Promise<unknown>) => operation())
const flashMock = jest.fn()

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
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (...args: [Record<string, string>, () => Promise<unknown>]) => scopedHeadersMock(...args),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  NotesSection: () => null,
  RecordNotFoundState: ({ label }: { label: string }) => <div data-testid="record-not-found">{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div data-testid="error-message">{label}</div>,
  DetailFieldsSection: ({ fields }: { fields: Array<{ key: string; render?: () => React.ReactNode }> }) => (
    <div>{fields.filter((field) => field.key === 'annualRevenue').map((field) => <div key={field.key}>{field.render?.()}</div>)}</div>
  ),
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
jest.mock('../../../../../components/detail/AnnualRevenueField', () => ({
  AnnualRevenueField: ({ amount, currency, onSave }: {
    amount: string | null
    currency: string | null
    onSave: (value: { amount: number | null; amountExact: string | null; currency: string | null }) => Promise<void>
  }) => {
    const [error, setError] = React.useState('')
    return <div>
      <output data-testid="revenue-value">{amount ?? 'empty'}:{currency ?? 'none'}</output>
      <button type="button" onClick={() => void onSave({ amount: 750000.25, amountExact: '750000.25', currency: null }).catch((reason: Error) => setError(reason.message))}>Save without currency</button>
      <button type="button" onClick={() => void onSave({ amount: 1250.5, amountExact: '1250.50', currency: 'PLN' }).catch((reason: Error) => setError(reason.message))}>Save PLN</button>
      <span>{error}</span>
    </div>
  },
}))
jest.mock('../../../../../components/detail/DetailTabsLayout', () => ({ DetailTabsLayout: () => null }))
jest.mock('../../../../../components/detail/InlineEditors', () => ({
  renderMultilineMarkdownDisplay: () => null,
  InlineDictionaryEditor: () => null,
}))

const companyId = '2408107d-0000-4000-8000-000000000001'
const originalVersion = '2026-11-24T10:00:00.000Z'
const savedVersion = '2026-11-24T10:01:00.000Z'
const versionHeader = 'x-om-ext-optimistic-lock-expected-updated-at'

describe('company annual revenue saves (#9848)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallOrThrowMock.mockResolvedValue({ ok: true, result: { ok: true, updatedAt: savedVersion } })
    readApiResultOrThrowMock.mockResolvedValue({
      company: { id: companyId, displayName: 'Company', updatedAt: originalVersion },
      profile: { annualRevenue: null },
      customFields: {}, tags: [], addresses: [], comments: [], activities: [], deals: [], todos: [], people: [],
    })
  })

  it('saves revenue and empty currency in one versioned request', async () => {
    renderWithProviders(<CompanyDetailPage params={{ id: companyId }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save without currency' }))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Saved successfully.', 'success'))
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(apiCallOrThrowMock.mock.calls[0][1].body)).toEqual({
      id: companyId, annualRevenue: '750000.25', customFields: { annual_revenue_currency: null },
    })
    expect(scopedHeadersMock.mock.calls[0][0]).toEqual({ [versionHeader]: originalVersion })
    expect(screen.getByTestId('revenue-value')).toHaveTextContent('750000.25:none')
  })

  it('updates currency and uses the returned version for the next inline save', async () => {
    renderWithProviders(<CompanyDetailPage params={{ id: companyId }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save PLN' }))

    await waitFor(() => expect(screen.getByTestId('revenue-value')).toHaveTextContent('1250.50:PLN'))
    fireEvent.click(screen.getByRole('button', { name: 'Save without currency' }))

    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalledTimes(2))
    expect(scopedHeadersMock.mock.calls[1][0]).toEqual({ [versionHeader]: savedVersion })
    expect(JSON.parse(apiCallOrThrowMock.mock.calls[0][1].body).customFields).toEqual({ annual_revenue_currency: 'PLN' })
  })

  it('leaves both displayed values unchanged and reports no success after a failed write', async () => {
    apiCallOrThrowMock.mockRejectedValueOnce(new Error('Save refused'))
    renderWithProviders(<CompanyDetailPage params={{ id: companyId }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save PLN' }))

    expect(await screen.findByText('Save refused')).toBeInTheDocument()
    expect(screen.getByTestId('revenue-value')).toHaveTextContent('empty:none')
    expect(flashMock).not.toHaveBeenCalled()
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
  })
})
