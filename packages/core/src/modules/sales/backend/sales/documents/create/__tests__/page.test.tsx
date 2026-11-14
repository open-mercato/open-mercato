/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'

let mockSearch = ''
const mockFormMounted = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('../../../../../components/documents/SalesDocumentForm', () => {
  const ReactForMock = require('react') as typeof React
  return {
    SalesDocumentForm: ({ initialKind }: { initialKind?: string }) => {
      ReactForMock.useEffect(() => { mockFormMounted(initialKind) }, [])
      return null
    },
  }
})

const CreateSalesDocumentPage = require('../page').default as React.ComponentType

describe('CreateSalesDocumentPage', () => {
  beforeEach(() => {
    mockFormMounted.mockClear()
    mockSearch = ''
  })

  it('starts a fresh form when ?kind= changes during client navigation', () => {
    mockSearch = 'kind=order'
    const { rerender } = render(<CreateSalesDocumentPage />)
    expect(mockFormMounted).toHaveBeenCalledTimes(1)
    expect(mockFormMounted).toHaveBeenLastCalledWith('order')

    mockSearch = ''
    rerender(<CreateSalesDocumentPage />)

    expect(mockFormMounted).toHaveBeenCalledTimes(2)
    expect(mockFormMounted).toHaveBeenLastCalledWith(undefined)
  })

  it('keeps the form mounted while the kind stays the same', () => {
    mockSearch = 'kind=quote'
    const { rerender } = render(<CreateSalesDocumentPage />)
    mockSearch = 'kind=quote&other=1'
    rerender(<CreateSalesDocumentPage />)
    expect(mockFormMounted).toHaveBeenCalledTimes(1)
  })
})
