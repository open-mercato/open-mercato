/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import EditCatalogProductPage from '../page'

const mockTranslate = (_key: string, fallback?: string) => fallback ?? _key

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
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

describe('EditCatalogProductPage — reload lands at the top instead of mid-page (#6171)', () => {
  const originalScrollRestoration = window.history.scrollRestoration

  beforeEach(() => {
    window.history.scrollRestoration = 'auto'
    window.location.hash = ''
    window.scrollTo = jest.fn()
  })

  afterEach(() => {
    window.history.scrollRestoration = originalScrollRestoration
    window.location.hash = ''
  })

  it('opts out of native scroll restoration and scrolls to the top when there is no hash', async () => {
    render(<EditCatalogProductPage params={{ id: 'prod-1' }} />)

    await waitFor(() => expect(window.history.scrollRestoration).toBe('manual'))
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('does not force-scroll to the top when a section hash is present', async () => {
    window.location.hash = '#options'

    render(<EditCatalogProductPage params={{ id: 'prod-1' }} />)

    await waitFor(() => expect(window.history.scrollRestoration).toBe('manual'))
    expect(window.scrollTo).not.toHaveBeenCalled()
  })
})
