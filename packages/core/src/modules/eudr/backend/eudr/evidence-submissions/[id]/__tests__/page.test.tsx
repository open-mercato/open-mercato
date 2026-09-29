/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import EditEudrEvidenceSubmissionPage from '../page'

const apiCallMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  RecordNotFoundState: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/backend/SectionHeader', () => ({
  CollapsibleSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: (message: string) => new Error(message),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const stableTranslate = (key: string) => key
  return {
    useT: () => stableTranslate,
    I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

const crudFormPropsCapture: { current: Record<string, unknown> | null } = { current: null }
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    crudFormPropsCapture.current = props
    return <div>form</div>
  },
}))

jest.mock('@open-mercato/core/modules/attachments/fields/attachment', () => ({
  AttachmentInput: ({ onUploaded }: { onUploaded?: () => void }) => (
    <button type="button" data-testid="mock-upload" onClick={() => onUploaded?.()}>
      upload
    </button>
  ),
}))

jest.mock('../../../../../components/formConfig', () => ({
  CompanySelectField: () => null,
  CountrySelectField: () => null,
  MappingSelectField: () => null,
  PlotMultiSelectField: () => null,
  StatementSelectField: () => null,
  commodityOptions: () => [],
  submissionStatusOptions: () => [],
  parseGeolocationInput: () => null,
}))

const STALE_UPDATED_AT = '2026-07-30T14:27:22.000Z'
const FRESH_UPDATED_AT = '2026-07-30T14:29:57.000Z'

function submissionRecord(updatedAt: string) {
  return {
    id: 'sub-1',
    supplierEntityId: 'supplier-1',
    supplierSnapshot: null,
    commodity: 'cocoa',
    productMappingId: null,
    statementId: null,
    plotIds: [],
    originCountry: null,
    geolocation: null,
    quantityKg: null,
    batchNumber: null,
    harvestFrom: null,
    harvestTo: null,
    producerName: null,
    attachmentIds: [],
    status: 'draft',
    completenessScore: 33,
    missingFields: [],
    notes: null,
    createdAt: '2026-07-30T14:00:00.000Z',
    updatedAt,
  }
}

describe('EditEudrEvidenceSubmissionPage optimistic-lock snapshot', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    crudFormPropsCapture.current = null
  })

  it('refreshes the lock snapshot after an attachment upload without remounting the form', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: true, result: { items: [submissionRecord(STALE_UPDATED_AT)] } })
      .mockResolvedValueOnce({ ok: true, result: { items: [submissionRecord(FRESH_UPDATED_AT)] } })

    renderWithProviders(<EditEudrEvidenceSubmissionPage params={{ id: 'sub-1' }} />)

    await waitFor(() => {
      expect(crudFormPropsCapture.current).not.toBeNull()
    })
    expect(crudFormPropsCapture.current?.optimisticLockUpdatedAt).toBe(STALE_UPDATED_AT)
    const initialValuesBeforeUpload = crudFormPropsCapture.current?.initialValues

    fireEvent.click(screen.getByTestId('mock-upload'))

    await waitFor(() => {
      expect(crudFormPropsCapture.current?.optimisticLockUpdatedAt).toBe(FRESH_UPDATED_AT)
    })
    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(crudFormPropsCapture.current?.initialValues).toBe(initialValuesBeforeUpload)
  })

  it('keeps the loaded snapshot when the refresh call fails', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: true, result: { items: [submissionRecord(STALE_UPDATED_AT)] } })
      .mockResolvedValueOnce({ ok: false, result: null })

    renderWithProviders(<EditEudrEvidenceSubmissionPage params={{ id: 'sub-1' }} />)

    await waitFor(() => {
      expect(crudFormPropsCapture.current).not.toBeNull()
    })

    fireEvent.click(screen.getByTestId('mock-upload'))

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledTimes(2)
    })
    expect(crudFormPropsCapture.current?.optimisticLockUpdatedAt).toBe(STALE_UPDATED_AT)
  })
})
