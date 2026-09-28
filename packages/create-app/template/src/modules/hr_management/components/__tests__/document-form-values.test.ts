/** @jest-environment node */
/**
 * Pins the employee-document form's mapping and payload.
 *
 * Same two traps as the sibling forms, plus one that is specific to this register: an expiry date is
 * genuinely optional (a contract or a certificate may not expire), so an empty value has to survive as
 * `null` on update instead of being dropped — a cleared expiry is a correction an operator makes, and
 * the list then reports the record as having no date rather than as valid.
 */
import {
  buildEmployeeDocumentFormDefaults,
  toEmployeeDocumentFormValues,
  toEmployeeDocumentPayload,
} from '../EmployeeDocumentForm'
import type { EmployeeDocumentRow } from '../EmployeeDocumentsTable'

const UPDATED_AT = '2026-09-27T06:00:00.000Z'
const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

function document(overrides: Partial<EmployeeDocumentRow> = {}): EmployeeDocumentRow {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    employee_id: EMPLOYEE_ID,
    document_type: 'iqama',
    document_number: '2345678901',
    issue_date: '2025-01-15T00:00:00.000Z',
    expiry_date: '2026-10-20T00:00:00.000Z',
    notes: 'Renewal in progress',
    updated_at: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

describe('employee document form initial values', () => {
  it('threads the record version into initialValues so CrudForm can derive the lock header', () => {
    expect(toEmployeeDocumentFormValues(document()).updatedAt).toBe(UPDATED_AT)
  })

  it('falls back to the snake_case version the list API actually returns', () => {
    expect(toEmployeeDocumentFormValues(document({ updatedAt: undefined, updated_at: UPDATED_AT })).updatedAt).toBe(UPDATED_AT)
  })

  it('degrades to null rather than undefined when the API omits the version', () => {
    expect(toEmployeeDocumentFormValues(document({ updatedAt: undefined, updated_at: undefined })).updatedAt).toBeNull()
  })

  it('reduces both dates to the date part a date input accepts', () => {
    const values = toEmployeeDocumentFormValues(document())
    expect(values.issueDate).toBe('2025-01-15')
    expect(values.expiryDate).toBe('2026-10-20')
  })

  it('converts the snake_case row into camelCase form values', () => {
    const values = toEmployeeDocumentFormValues(document())

    expect(values).toMatchObject({
      employeeId: EMPLOYEE_ID,
      documentType: 'iqama',
      documentNumber: '2345678901',
      notes: 'Renewal in progress',
    })
    expect(values).not.toHaveProperty('document_type')
  })

  it('renders absent optional values as empty strings', () => {
    const values = toEmployeeDocumentFormValues(document({
      document_number: null,
      issue_date: null,
      expiry_date: null,
      notes: null,
    }))

    expect(values.documentNumber).toBe('')
    expect(values.issueDate).toBe('')
    expect(values.expiryDate).toBe('')
    expect(values.notes).toBe('')
  })

  it('starts a new document on the default type the register expects', () => {
    expect(buildEmployeeDocumentFormDefaults()).toMatchObject({
      employeeId: '',
      documentType: 'national_id',
      documentNumber: '',
      expiryDate: '',
      updatedAt: null,
    })
  })
})

describe('employee document form payload', () => {
  it('sends the chosen type and trims the number', () => {
    const payload = toEmployeeDocumentPayload({
      ...buildEmployeeDocumentFormDefaults(EMPLOYEE_ID),
      employeeId: EMPLOYEE_ID,
      documentType: 'passport',
      documentNumber: '  X123456  ',
      issueDate: '2025-01-15',
      expiryDate: '2030-01-15',
    })

    expect(payload).toEqual({
      employeeId: EMPLOYEE_ID,
      documentType: 'passport',
      documentNumber: 'X123456',
      issueDate: '2025-01-15',
      expiryDate: '2030-01-15',
      notes: null,
    })
  })

  it('keeps an empty expiry as null, because not every document expires', () => {
    const payload = toEmployeeDocumentPayload({
      ...buildEmployeeDocumentFormDefaults(),
      employeeId: EMPLOYEE_ID,
      documentType: 'contract',
      expiryDate: '',
    })

    expect(payload.expiryDate).toBeNull()
    expect(payload).not.toHaveProperty('expiry_date')
  })

  it('never sends the record id, which belongs to the URL-bearing update call', () => {
    const payload = toEmployeeDocumentPayload(buildEmployeeDocumentFormDefaults('00000000-0000-4000-8000-000000000003'))
    expect(payload).not.toHaveProperty('id')
  })
})
