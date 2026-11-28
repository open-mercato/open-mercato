/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AddressEditor, type AddressEditorDraft } from '../AddressEditor'

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/customers/people/1',
  useSearchParams: () => new URLSearchParams(),
}))

const t = (_key: string, fallback?: string) => fallback ?? ''

const draft = (over: Partial<AddressEditorDraft> = {}): AddressEditorDraft => ({
  name: '', purpose: '', companyName: '', addressLine1: 'Baker Street 10', addressLine2: '',
  buildingNumber: '', flatNumber: '', city: 'London', region: '', postalCode: 'NW1',
  country: 'GB', isPrimary: false, ...over,
})

function render(props: Record<string, unknown> = {}) {
  return renderWithProviders(
    <AddressEditor value={draft(props.value as Partial<AddressEditorDraft>)} format="line_first" t={t} onChange={() => {}} {...props} />,
  )
}

describe('shared AddressEditor — recipient name + phone (#5232)', () => {
  it('renders neither by default', () => {
    render()
    expect(screen.queryByPlaceholderText('Recipient name')).toBeNull()
    expect(screen.queryByPlaceholderText('Phone')).toBeNull()
  })

  it('renders each behind its own flag, with the stored value', () => {
    const { unmount } = render({ showRecipientNameField: true, value: { recipientName: 'Alice', phone: '123' } })
    expect(screen.getByPlaceholderText('Recipient name')).toHaveValue('Alice')
    expect(screen.queryByPlaceholderText('Phone')).toBeNull()
    unmount()

    render({ showPhoneField: true, value: { recipientName: 'Alice', phone: '123' } })
    expect(screen.getByPlaceholderText('Phone')).toHaveValue('123')
    expect(screen.queryByPlaceholderText('Recipient name')).toBeNull()
  })

  it('disables both with the rest of the form', () => {
    render({ showRecipientNameField: true, showPhoneField: true, disabled: true })
    expect(screen.getByPlaceholderText('Recipient name')).toBeDisabled()
    expect(screen.getByPlaceholderText('Phone')).toBeDisabled()
  })

  it('shows validation errors with the status error token, not text-destructive', () => {
    render({
      showRecipientNameField: true,
      showPhoneField: true,
      errors: { recipientName: 'Recipient name is too long', phone: 'Phone is too long' },
    })
    for (const message of ['Recipient name is too long', 'Phone is too long']) {
      const node = screen.getByText(message)
      expect(node).toHaveClass('text-status-error-text')
      expect(node).not.toHaveClass('text-destructive')
    }
  })
})
