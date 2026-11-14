/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { VariantFormValues } from '@open-mercato/core/modules/catalog/components/products/variantForm'
import CreateVariantPage from '../page'

const mockPush = jest.fn()
const mockTranslate = jest.fn((key: string, fallback?: string) => fallback ?? key)
let mockForm: { initialValues: VariantFormValues; isLoading: boolean; onSubmit: (values: VariantFormValues) => Promise<void> } | null = null

jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({ error: jest.fn() }) }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/ui/backend/detail', () => ({ ErrorMessage: () => null, RecordNotFoundState: () => null }))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: NonNullable<typeof mockForm>) => { mockForm = props; return null },
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn(), readApiResultOrThrow: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/customFieldValues', () => ({ collectCustomFieldValues: () => ({}) }))
jest.mock('@open-mercato/core/modules/catalog/components/products/VariantBuilder', () => ({
  VariantBasicsSection: () => null,
  VariantOptionValuesSection: () => null,
  VariantDimensionsSection: () => null,
  VariantMetadataSection: () => null,
  VariantPricesSection: () => null,
  VariantMediaSection: () => null,
}))
jest.mock('#generated/entities.ids.generated', () => ({ E: { catalog: { catalog_product_variant: 'catalog:catalog_product_variant' } } }), { virtual: true })

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>
const readApiResultMock = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
const createCrudMock = createCrud as jest.MockedFunction<typeof createCrud>

describe('CreateVariantPage media transfer failures', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockForm = null
    createCrudMock.mockResolvedValue({ result: { id: 'variant-1' } } as never)
    readApiResultMock.mockImplementation(async (url) => ({
      items: String(url).includes('/price-kinds')
        ? [{ id: 'price-kind-1', code: 'regular', title: 'Regular', display_mode: 'including-tax', currency_code: 'USD' }]
        : [],
    }) as never)
  })

  it.each(['network rejection', 'short acknowledgement'] as const)(
    'keeps the variant, completes price writes and warns after a %s in the second media batch',
    async (failure) => {
      let transferCalls = 0
      apiCallMock.mockImplementation(async (url) => {
        if (String(url).startsWith('/api/catalog/products?')) {
          return { ok: true, result: { items: [{ id: 'product-1', title: 'Product' }] } } as never
        }
        transferCalls += 1
        if (transferCalls === 1) return { ok: true, result: { updated: 100 } } as never
        if (failure === 'network rejection') throw new TypeError('Failed to fetch')
        return { ok: true, result: { updated: 0 } } as never
      })
      render(<CreateVariantPage params={{ productId: 'product-1' }} />)
      await waitFor(() => expect(mockForm?.isLoading).toBe(false))
      const form = mockForm!
      await act(async () => {
        await form.onSubmit({
          ...form.initialValues,
          name: 'Variant',
          mediaDraftId: 'draft-1',
          mediaItems: Array.from({ length: 101 }, (_, index) => ({
            id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            url: `/api/attachments/file/${index}`,
            fileName: `image-${index}.png`,
            fileSize: 1024,
          })),
          prices: { 'price-kind-1': { priceKindId: 'price-kind-1', amount: '12', displayMode: 'including-tax' } },
        })
      })
      expect(transferCalls).toBe(2)
      expect(createCrudMock).toHaveBeenCalledWith('catalog/variants', expect.objectContaining({ productId: 'product-1', name: 'Variant' }))
      expect(createCrudMock).toHaveBeenCalledWith('catalog/prices', expect.objectContaining({ variantId: 'variant-1', unitPriceGross: '12' }))
      expect(mockTranslate).toHaveBeenCalledWith(
        'catalog.variants.form.mediaTransferIncomplete',
        expect.any(String),
        { failed: 1, total: 101 },
      )
      expect(flash).toHaveBeenCalledTimes(1)
      expect(flash).toHaveBeenCalledWith('Variant created, but {failed} of {total} media files could not be attached.', 'warning')
      expect(mockPush).toHaveBeenCalledWith('/backend/catalog/products/product-1#variants')
    },
  )
})
