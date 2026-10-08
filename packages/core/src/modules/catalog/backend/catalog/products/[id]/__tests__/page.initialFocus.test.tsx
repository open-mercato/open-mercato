/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import EditCatalogProductPage from '../page'

const mockTranslate = (_key: string, fallback?: string) => fallback ?? _key
const mockCrudForm = jest.fn((_props: Record<string, unknown>) => null)

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => mockCrudForm(props),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useLocale: () => 'en-US',
}))

jest.mock('next/link', () => ({ children }: { children: React.ReactNode }) => <span>{children}</span>)

jest.mock('@open-mercato/ui/backend/messages/SendObjectMessageDialog.tsx', () => ({
  SendObjectMessageDialog: () => null,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn().mockResolvedValue({ ok: true, result: { items: [] } }),
  readApiResultOrThrow: jest.fn().mockResolvedValue({ items: [] }),
  withScopedApiRequestHeaders: jest.fn(
    (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn().mockResolvedValue({ ok: true, result: { ok: true } }),
  createCrud: jest.fn().mockResolvedValue({ ok: true, result: {} }),
  deleteCrud: jest.fn().mockResolvedValue({ ok: true, result: {} }),
}))

describe('EditCatalogProductPage — no focus jump to the first custom attribute (#7088)', () => {
  beforeEach(() => {
    mockCrudForm.mockClear()
    window.scrollTo = jest.fn()
  })

  it('opts the product form out of CrudForm initial autofocus', async () => {
    render(<EditCatalogProductPage params={{ id: 'prod-1' }} />)

    await waitFor(() => expect(mockCrudForm).toHaveBeenCalled())
    const groups = mockCrudForm.mock.calls[0][0].groups as Array<{ kind?: string; fields?: unknown[] }>
    expect(groups.some((group) => group.kind === 'customFields')).toBe(true)
    for (const call of mockCrudForm.mock.calls) {
      expect(call[0].disableInitialFocus).toBe(true)
    }
  })
})
