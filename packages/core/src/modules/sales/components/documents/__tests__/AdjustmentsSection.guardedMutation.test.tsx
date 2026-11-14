/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { SalesDocumentAdjustmentsSection } from '../AdjustmentsSection'
import type { AdjustmentSubmitPayload } from '../AdjustmentDialog'

const mockRunDocumentMutation = jest.fn(async (operation: () => Promise<unknown>) => operation())
const mockCreateCrud = jest.fn(async () => ({ ok: true }))
const mockUpdateCrud = jest.fn(async () => ({ ok: true }))
const mockTranslate = (_key: string, fallback?: string) => fallback ?? _key
let submitAdjustment: ((values: AdjustmentSubmitPayload) => Promise<void>) | null = null

jest.mock('../useSalesDocumentMutation', () => ({
  useSalesDocumentMutation: (kind: string, documentId: string) => {
    expect(kind).toBe('quote')
    expect(documentId).toBe('quote-id')
    return mockRunDocumentMutation
  },
}))
jest.mock('../AdjustmentDialog', () => ({
  AdjustmentDialog: ({ onSubmit }: { onSubmit: (values: AdjustmentSubmitPayload) => Promise<void> }) => {
    submitAdjustment = onSubmit
    return null
  },
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useLocale: () => 'en',
}))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'organization-id', tenantId: 'tenant-id' }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: async () => ({ ok: true, result: { items: [] } }),
  withScopedApiRequestHeaders: async (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => mockCreateCrud(...args),
  updateCrud: (...args: unknown[]) => mockUpdateCrud(...args),
  deleteCrud: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({ DataTable: () => null }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../optimisticLock', () => ({ handleSectionMutationError: () => false }))

describe('quote adjustment aggregate session', () => {
  beforeEach(() => { jest.clearAllMocks(); submitAdjustment = null })

  it.each([undefined, 'adjustment-id'])('guards a shipping adjustment before its create/update write (%s)', async (id) => {
    render(<SalesDocumentAdjustmentsSection documentId="quote-id" kind="quote" currencyCode="USD" />)
    await waitFor(() => expect(submitAdjustment).not.toBeNull())
    await act(async () => {
      await submitAdjustment?.({ id, kind: 'shipping', label: 'Shipping', amountNet: 15, amountGross: 18.45 })
    })
    expect(mockRunDocumentMutation).toHaveBeenCalledTimes(1)
    expect(mockRunDocumentMutation).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      quoteId: 'quote-id', kind: 'shipping', amountNet: 15,
    }))
    const action = id ? mockUpdateCrud : mockCreateCrud
    expect(action).toHaveBeenCalledWith('sales/quote-adjustments', expect.objectContaining({
      quoteId: 'quote-id', ...(id ? { id } : {}),
    }), expect.any(Object))
  })
})
