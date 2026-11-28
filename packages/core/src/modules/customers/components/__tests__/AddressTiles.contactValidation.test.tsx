/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CustomerAddressTiles, type Translator } from '../AddressTiles'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { addressFormat: 'line_first' } })),
}))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))
jest.mock('../detail/hooks/useAddressTypes', () => ({
  useAddressTypes: () => ({ options: [], map: new Map(), loading: false }),
}))
jest.mock('../detail/hooks/useCustomerDictionary', () => ({
  ensureCustomerDictionary: jest.fn(),
  invalidateCustomerDictionary: jest.fn(),
}))
jest.mock('../AddressEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, errors }: {
    value: { addressLine1: string; recipientName?: string; phone?: string }
    onChange: (value: { addressLine1: string; recipientName?: string; phone?: string }) => void
    errors: Record<string, string>
  }) => (
    <div>
      {(['addressLine1', 'recipientName', 'phone'] as const).map((field) => (
        <label key={field}>
          {field}
          <input aria-label={field} value={value[field] ?? ''} onChange={(event) => onChange({ ...value, [field]: event.target.value })} />
          {errors[field] ? <span role="alert">{errors[field]}</span> : null}
        </label>
      ))}
    </div>
  ),
}))

const translate: Translator = (key, fallback, params) => (
  key.endsWith('.tooLong') ? `${params?.field} max ${params?.max}` : fallback ?? key
)

describe('CustomerAddressTiles contact validation', () => {
  it.each([['recipientName', 200], ['phone', 50]] as const)(
    'keeps an over-limit %s draft open until corrected',
    async (field, maximum) => {
      const onCreate = jest.fn()
      renderWithProviders(<CustomerAddressTiles addresses={[]} onCreate={onCreate} t={translate} emptyLabel="Empty" />)
      fireEvent.click(screen.getByRole('button', { name: 'customers.people.detail.addresses.add' }))
      await waitFor(() => expect(screen.queryByText('Loading address preferences…')).not.toBeInTheDocument())
      fireEvent.change(screen.getByLabelText('addressLine1'), { target: { value: '10 Example Street' } })
      fireEvent.change(screen.getByLabelText(field), { target: { value: 'x'.repeat(maximum + 1) } })
      fireEvent.click(screen.getByRole('button', { name: 'customers.people.detail.addresses.save' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(`max ${maximum}`)
      expect(onCreate).not.toHaveBeenCalled()
      expect(screen.getByLabelText('addressLine1')).toHaveValue('10 Example Street')
      const corrected = 'x'.repeat(maximum)
      fireEvent.change(screen.getByLabelText(field), { target: { value: `  ${corrected}  ` } })
      fireEvent.click(screen.getByRole('button', { name: 'customers.people.detail.addresses.save' }))
      await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ addressLine1: '10 Example Street', [field]: corrected })))
    },
  )
})
