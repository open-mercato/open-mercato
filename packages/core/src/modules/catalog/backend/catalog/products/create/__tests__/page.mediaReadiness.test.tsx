/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { CrudFormGroup, CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import type { ProductFormValues } from '@open-mercato/core/modules/catalog/components/products/productForm'
import CreateCatalogProductPage from '../page'

const mockPush = jest.fn()
const mockTranslate = (key: string, fallback?: string, variables?: Record<string, unknown>) =>
  (fallback ?? key).replace(/\{(\w+)\}/g, (match, token: string) => String(variables?.[token] ?? match))
let mockForm: {
  initialValues: ProductFormValues
  groups: CrudFormGroup[]
  onSubmit: (values: ProductFormValues) => Promise<void>
} | null = null

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: () => null }),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate, useLocale: () => 'en' }))
jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({ error: jest.fn() }) }))
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
jest.mock('@open-mercato/ui/backend/inputs/MarkdownField', () => ({ __esModule: true, default: () => null }))
jest.mock('@open-mercato/ui/backend/inputs/TagsInput', () => ({ TagsInput: () => null }))
jest.mock('@open-mercato/core/modules/catalog/components/products/ProductCategorizeSection', () => ({ ProductCategorizeSection: () => null }))
jest.mock('@open-mercato/core/modules/catalog/components/products/ProductUomSection', () => ({ ProductUomSection: () => null }))
jest.mock('@open-mercato/core/modules/catalog/components/products/ProductComplianceSection', () => ({ ProductComplianceSection: () => null }))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>
const readApiResultMock = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
const createCrudMock = createCrud as jest.MockedFunction<typeof createCrud>

describe('CreateCatalogProductPage media readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockForm = null
    readApiResultMock.mockResolvedValue({ items: [] } as never)
    createCrudMock.mockImplementation(async (resource) => ({
      result: { id: resource === 'catalog/products' ? 'product-1' : 'variant-1' },
    }) as never)
  })

  it.each(['success', 'HTTP failure', 'transit failure', 'short acknowledgement'] as const)(
    'rejects quick-save during upload and handles the completed batch after %s', async (outcome) => {
      let finishUpload: (result: { ok: boolean; result: { item: Record<string, unknown> } }) => void = () => {
        throw new Error('[internal] The upload has not started.')
      }
      const upload = new Promise<{ ok: boolean; result: { item: Record<string, unknown> } }>((resolve) => {
        finishUpload = resolve
      })
      apiCallMock
        .mockResolvedValueOnce({ ok: true, result: { item: { id: 'media-1', url: '/image/media-1', fileName: 'photo-1.png', fileSize: 5 } } } as never)
        .mockReturnValueOnce(upload as never)
      if (outcome === 'transit failure') apiCallMock.mockRejectedValue(new TypeError('Failed to fetch'))
      else apiCallMock.mockResolvedValue({
        ok: outcome !== 'HTTP failure', result: { updated: outcome === 'short acknowledgement' ? 1 : 2 },
      } as never)
      render(<CreateCatalogProductPage />)
      await waitFor(() => expect(readApiResultMock).toHaveBeenCalledTimes(2))
      const form = mockForm!
      const values = { ...form.initialValues, title: 'Upload readiness product' }
      const setValue = jest.fn((id: string, value: unknown) => {
        Object.assign(values, { [id]: value })
      })
      const builder = form.groups[0].component!({
        values, setValue, errors: {},
      } as CrudFormGroupComponentProps)
      const { container } = render(<>{builder}</>)
      const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!

      fireEvent.change(fileInput, { target: { files: [
        new File(['image'], 'photo-1.png', { type: 'image/png' }),
        new File(['image'], 'photo-2.png', { type: 'image/png' }),
      ] } })
      await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(2))
      await expect(form.onSubmit(values)).rejects.toMatchObject({ message: 'Uploading…' })
      expect(createCrudMock).not.toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()

      await act(async () => {
        finishUpload({ ok: true, result: { item: { id: 'media-2', url: '/image/media-2', fileName: 'photo-2.png', fileSize: 5 } } })
        await upload
      })
      expect(values.mediaItems.map((item) => item.id)).toEqual(['media-1', 'media-2'])
      await act(async () => { await form.onSubmit(values) })
      expect(createCrudMock).toHaveBeenCalledWith('catalog/products', expect.objectContaining({ title: values.title }))
      expect(apiCallMock).toHaveBeenLastCalledWith('/api/attachments/transfer', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          entityId: 'catalog:catalog_product', attachmentIds: ['media-1', 'media-2'],
          fromRecordId: values.mediaDraftId, toRecordId: 'product-1',
        }),
      }), { fallback: null })
      if (outcome === 'success') expect(flash).toHaveBeenCalledWith('Product created.', 'success')
      else expect(flash).toHaveBeenCalledWith(
        `Product created, but ${outcome === 'short acknowledgement' ? 1 : 2} of 2 media files could not be attached.`, 'warning',
      )
      expect(mockPush).toHaveBeenCalledWith('/backend/catalog/products/product-1')
  })
})
