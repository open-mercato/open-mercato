/** @jest-environment jsdom */

import * as React from 'react'
import { act, cleanup, render } from '@testing-library/react'
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
}
const mockReadApiResult = jest.fn()

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
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: mockRetry }),
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
  FormHeader: ({ title }: { title: React.ReactNode }) => <header data-testid="document-header">{title}</header>,
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
