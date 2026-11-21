/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import EditVariantPage from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/backend/catalog/products/p1/variants/v1',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('next/link', () => ({ children }: { children: React.ReactNode }) => <span>{children}</span>)
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn().mockResolvedValue(true), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/custom-fields/FieldDefinitionsManager', () => ({
  __esModule: true,
  FieldDefinitionsManager: React.forwardRef(() => <div>field definitions</div>),
}))
jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({
  __esModule: true,
  buildFormFieldFromCustomFieldDef: jest.fn(() => null),
  buildFormFieldsFromCustomFields: jest.fn(() => []),
  fetchCustomFieldFormStructure: jest.fn(async () => ({
    fields: [],
    definitions: [],
    metadata: { items: [], fieldsetsByEntity: {}, entitySettings: {} },
  })),
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
  updateCrud: jest.fn().mockResolvedValue(undefined),
  deleteCrud: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((_headers: Record<string, string>, run: () => Promise<unknown>) => run()),
}))

const apiCallMock = apiCall as jest.Mock
const readApiResultOrThrowMock = readApiResultOrThrow as jest.Mock
const updateCrudMock = updateCrud as jest.Mock

const variantRecordBase = {
  id: 'v-1',
  product_id: 'prod-1',
  name: 'QA Omnibus variant',
  sku: 'QA-9372-VARIANT',
  hs_code: null,
  option_values: {},
  updated_at: '2026-01-01T00:00:00.000Z',
}

function mockVariantRecord(omnibusExempt: boolean | null) {
  apiCallMock.mockImplementation((url: string) => {
    if (url.includes('/api/catalog/variants?id=')) {
      return Promise.resolve({
        ok: true,
        result: { items: [{ ...variantRecordBase, omnibus_exempt: omnibusExempt }] },
      })
    }
    return Promise.resolve({ ok: true, result: { items: [] } })
  })
  readApiResultOrThrowMock.mockImplementation((url: string) => {
    if (url.includes('/api/catalog/price-kinds')) {
      return Promise.resolve({
        items: [{ id: 'pk-1', code: 'regular', title: 'Regular', display_mode: 'including-tax' }],
      })
    }
    return Promise.resolve({ items: [] })
  })
}

function renderPage() {
  return renderWithProviders(<EditVariantPage params={{ productId: 'prod-1', variantId: 'v-1' }} />)
}

async function waitForForm(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('#catalog-variant-hs-code')).toBeTruthy())
  const trigger = container.querySelector('#catalog-variant-omnibus-exempt') as HTMLElement | null
  expect(trigger).toBeTruthy()
  return trigger as HTMLElement
}

describe('EditVariantPage — Omnibus perishable exemption round-trip (#9372 QA)', () => {
  const cases: Array<{ stored: boolean | null; label: string; expected: boolean | null }> = [
    { stored: true, label: 'Exempt (perishable)', expected: true },
    { stored: null, label: 'Inherit from product', expected: null },
    { stored: false, label: 'Not exempt', expected: false },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each(cases)(
    'renders a stored $stored exemption as $label after async hydration',
    async ({ stored, label }) => {
      mockVariantRecord(stored)
      const { container } = renderPage()
      const trigger = await waitForForm(container)
      await waitFor(() => expect(trigger.textContent).toContain(label))
    },
  )

  it.each(cases)(
    'preserves a stored $stored exemption when an unrelated field is saved',
    async ({ stored, expected }) => {
      mockVariantRecord(stored)
      const { container } = renderPage()
      await waitForForm(container)

      const hsCode = container.querySelector('#catalog-variant-hs-code') as HTMLInputElement
      fireEvent.change(hsCode, { target: { value: '123456' } })
      const saveButtons = screen.getAllByRole('button', { name: /^Save changes$/i })
      fireEvent.click(saveButtons[0])

      await waitFor(() => expect(updateCrudMock).toHaveBeenCalled())
      const [resource, payload] = updateCrudMock.mock.calls[0] as [string, Record<string, unknown>]
      expect(resource).toBe('catalog/variants')
      expect(payload.hsCode).toBe('123456')
      expect(payload.omnibusExempt).toBe(expected)
    },
  )
})
