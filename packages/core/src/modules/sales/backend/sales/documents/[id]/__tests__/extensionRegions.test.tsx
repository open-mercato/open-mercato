/** @jest-environment jsdom */

import * as React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import {
  registerCoreInjectionTables,
  registerCoreInjectionWidgets,
  registerEnabledModuleIds,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import type { SalesDocumentExtensionContext } from '../../../../../components/documents/SalesDocumentExtensionSpot'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key
const mockRetry = jest.fn<Promise<boolean>, []>().mockResolvedValue(true)
const mockSearchParams = new URLSearchParams()
const mockChromePayload = { grantedFeatures: [] }
const mockDocument = {
  id: 'document-1',
  orderNumber: 'SO-1',
  quoteNumber: 'QT-1',
  status: 'draft',
  currencyCode: 'USD',
  organizationId: 'organization-1',
  tenantId: 'tenant-1',
  updatedAt: '2026-10-22T10:00:00.000Z',
  contactEmail: 'recipient@example.test',
}
const mockReadApiResult = jest.fn()
const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/backend/sales/documents/document-1',
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useLocale: () => 'en',
}))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: mockChromePayload, isReady: true }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn().mockResolvedValue({ ok: true, result: { items: [], granted: [] } }),
  apiCallOrThrow: jest.fn().mockResolvedValue({ result: {} }),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResult(...args),
  withScopedApiRequestHeaders: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: mockRunMutation, retryLastMutation: mockRetry }),
}))
jest.mock('@open-mercato/ui/backend/injection/recordContext', () => ({
  buildRecordInjectionContext: () => null,
  useSetCurrentRecordInjectionContext: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn() }))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: React.PropsWithChildren) => <main>{children}</main>,
  PageBody: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: ({ title, menuActions }: { title: React.ReactNode; menuActions?: Array<{ id: string; label: string; onSelect: () => void }> }) => (
    <header data-testid="document-header">
      {title}
      {menuActions?.filter((action) => action.id === 'send').map((action) => (
        <button key={action.id} onClick={action.onSelect}>{action.label}</button>
      ))}
    </header>
  ),
}))
jest.mock('@open-mercato/ui/backend/version-history', () => ({ VersionHistoryAction: () => null }))
jest.mock('@open-mercato/ui/backend/messages', () => ({ SendObjectMessageDialog: () => null }))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  CustomDataSection: () => <div data-testid="custom-data" />,
  DetailFieldsSection: () => <div data-testid="document-details" />,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  InlineTextEditor: () => null,
  LoadingMessage: () => <div data-testid="loading" />,
  RecordNotFoundState: () => <div data-testid="not-found" />,
  TabEmptyState: () => null,
  TagsSection: () => null,
  NotesSection: () => null,
  mapCommentSummary: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/inputs', () => ({ LookupSelect: () => null }))
jest.mock('@open-mercato/core/modules/customers/components/detail/hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({ data: { entries: [] } }),
}))
jest.mock('@open-mercato/core/modules/customers/backend/hooks/useEmailDuplicateCheck', () => ({
  useEmailDuplicateCheck: () => ({ duplicate: null, checking: false }),
}))
jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  DictionaryValue: () => null,
  createDictionaryMap: () => new Map(),
  renderDictionaryColor: () => null,
  renderDictionaryIcon: () => null,
}))
jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect', () => ({ DictionaryEntrySelect: () => null }))
jest.mock('@open-mercato/core/modules/sales/components/useSalesChannelsEnabled', () => ({
  useSalesChannelsEnabled: () => ({ enabled: false }),
}))
jest.mock('@open-mercato/core/modules/sales/components/DocumentCustomerCard', () => ({ DocumentCustomerCard: () => null }))
jest.mock('@open-mercato/core/modules/sales/components/ContactEmailDisplay', () => ({ ContactEmailDisplay: () => null }))
jest.mock('@open-mercato/core/modules/sales/components/documents/AddressesSection', () => ({ SalesDocumentAddressesSection: () => null }))
jest.mock('@open-mercato/core/modules/sales/components/documents/ItemsSection', () => ({ SalesDocumentItemsSection: () => null }))
jest.mock('@open-mercato/core/modules/sales/components/documents/PaymentsSection', () => ({ SalesDocumentPaymentsSection: () => null }))
jest.mock('@open-mercato/core/modules/sales/components/documents/AdjustmentsSection', () => ({ SalesDocumentAdjustmentsSection: () => null }))
jest.mock('@open-mercato/core/modules/sales/components/documents/ShipmentsSection', () => ({ SalesShipmentsSection: () => null }))
jest.mock('@open-mercato/core/modules/sales/components/documents/ReturnsSection', () => ({ SalesReturnsSection: () => null }))
jest.mock('@open-mercato/core/modules/sales/components/documents/DocumentTotals', () => ({ DocumentTotals: () => null }))

import SalesDocumentDetailPage from '../page'

beforeEach(() => {
  jest.clearAllMocks()
  mockReadApiResult.mockImplementation(async (url: string) => (
    /^\/api\/sales\/(orders|quotes)\?/.test(url) ? { items: [mockDocument] } : { items: [] }
  ))
  registerEnabledModuleIds(['sales', 'test_extensions'])
  registerCoreInjectionWidgets([])
  registerCoreInjectionTables([])
})

afterEach(() => {
  cleanup()
  registerCoreInjectionWidgets([])
  registerCoreInjectionTables([])
})

describe.each(['order', 'quote'] as const)('sales %s detail page extension mounts', (kind) => {
  it('mounts registered stage and closure widgets at the real page regions', async () => {
    const received = jest.fn()
    const entries: ModuleInjectionWidgetEntry[] = []
    const table: ModuleInjectionTable = {}
    for (const surface of ['stage-bar', 'closure']) {
      const spotId = `detail:sales.${kind}:${surface}`
      const widgetId = `test.${kind}.${surface}`
      entries.push({
        moduleId: 'test_extensions',
        key: widgetId,
        widgetId,
        source: 'app',
        loader: async () => ({
          metadata: { id: widgetId, title: widgetId },
          Widget: ({ context, data }: {
            context: SalesDocumentExtensionContext<typeof mockDocument>
            data?: typeof mockDocument
          }) => {
            received({ context, data })
            return <div data-testid={surface} />
          },
        }),
      })
      table[spotId] = { widgetId }
    }
    registerCoreInjectionWidgets(entries)
    registerCoreInjectionTables([{ moduleId: 'test_extensions', table }])

    const { findByTestId, getByTestId } = render(<SalesDocumentDetailPage params={{ id: mockDocument.id }} initialKind={kind} />)
    const stage = await findByTestId('stage-bar')
    const closure = await findByTestId('closure')
    expect(getByTestId('document-header').compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(getByTestId('document-details').compareDocumentPosition(closure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(closure.compareDocumentPosition(getByTestId('custom-data')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(received).toHaveBeenCalledWith({
      context: expect.objectContaining({
        kind,
        documentId: mockDocument.id,
        record: mockDocument,
        resourceKind: `sales.${kind}`,
        resourceId: mockDocument.id,
        formId: `record-lock:sales.${kind}:${mockDocument.id}`,
        retryLastMutation: mockRetry,
        organizationId: mockDocument.organizationId,
        tenantId: mockDocument.tenantId,
      }),
      data: mockDocument,
    })
  })

  it('does not mount extension widgets for a missing document', async () => {
    mockReadApiResult.mockResolvedValue({ items: [] })
    const { findByTestId, queryByTestId } = render(<SalesDocumentDetailPage params={{ id: 'missing' }} initialKind={kind} />)
    await findByTestId('not-found')
    await act(async () => {})
    expect(queryByTestId('document-header')).toBeNull()
    expect(queryByTestId('document-details')).toBeNull()
  })
})


describe('quote send refresh', () => {
  it.each([false, true])('refreshes the saved quote and uses its new version on resend (emailFailed=%s)', async (emailFailed) => {
    const { apiCall } = await import('@open-mercato/ui/backend/utils/apiCall')
    const { flash } = await import('@open-mercato/ui/backend/FlashMessages')
    const sentDocument = { ...mockDocument, status: 'sent', validUntil: new Date(Date.now() + 30 * 86400000).toISOString(), updatedAt: '2026-10-22T11:00:00.000Z' }
    ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
      if (url === '/api/sales/quotes/send') {
        mockReadApiResult.mockImplementation(async (readUrl: string) => (
          /^\/api\/sales\/quotes\?/.test(readUrl) ? { items: [sentDocument] } : { items: [] }
        ))
        return { ok: !emailFailed, status: emailFailed ? 400 : 200, result: emailFailed ? { quoteSent: true } : { ok: true } }
      }
      return { ok: true, result: { items: [], granted: [] } }
    })
    const view = render(<SalesDocumentDetailPage params={{ id: mockDocument.id }} initialKind="quote" />)
    fireEvent.click(await view.findByRole('button', { name: 'Send to customer' }))
    fireEvent.click(await view.findByRole('button', { name: 'Send quote', exact: true }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(flash).toHaveBeenCalledWith(
      emailFailed ? 'Quote marked as sent, but the email could not be delivered.' : 'Quote sent.',
      emailFailed ? 'error' : 'success',
    )
    fireEvent.click(view.getByRole('button', { name: 'Send to customer' }))
    expect((await view.findByRole('spinbutton') as HTMLInputElement).value).toBe('30')
    fireEvent.click(view.getByRole('button', { name: 'Send quote', exact: true }))
    await waitFor(() => {
      const sends = (apiCall as jest.Mock).mock.calls.filter(([url]: [string]) => url === '/api/sales/quotes/send')
      expect(sends).toHaveLength(2)
      expect(sends[1][1].headers).toEqual(expect.objectContaining({
        'x-om-ext-optimistic-lock-expected-updated-at': sentDocument.updatedAt,
      }))
    })
  })
})
