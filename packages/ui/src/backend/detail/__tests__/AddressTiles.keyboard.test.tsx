import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AddressTiles } from '../AddressTiles'
import type { AddressEditorDraft } from '../AddressEditor'

jest.mock('@open-mercato/ui/backend/detail', () => ({
  TabEmptyState: ({ action }: { action: { label: string; onClick: () => void } }) => (
    <button onClick={action.onClick}>{action.label}</button>
  ),
}))

jest.mock('../AddressEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, children }: {
    value: AddressEditorDraft
    onChange: (next: AddressEditorDraft) => void
    children?: React.ReactNode
  }) => (
    <>
      <input aria-label="Label" value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} />
      <input aria-label="Street" value={value.addressLine1} onChange={(event) => onChange({ ...value, addressLine1: event.target.value })} />
      <input aria-label="Nested selector" onKeyDown={(event) => event.preventDefault()} />
      {children}
    </>
  ),
}))

function renderTiles() {
  const onCreate = jest.fn(async () => undefined)
  renderWithProviders(
    <AddressTiles
      addresses={[]}
      onCreate={onCreate}
      t={(_key, fallback) => fallback ?? ''}
      emptyLabel="No addresses"
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add address' }))
  return onCreate
}

describe('AddressTiles keyboard actions', () => {
  it('cancels and discards an unsaved draft with Escape', () => {
    const onCreate = renderTiles()
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Unsaved' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Label' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Label' })).not.toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add address' }))
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('')
  })

  it('keeps the form open when a nested layer handled Escape', () => {
    renderTiles()
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Keep draft' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nested selector' }), { key: 'Escape' })
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('Keep draft')
  })

  it('still submits a valid draft with Ctrl+Enter', async () => {
    const onCreate = renderTiles()
    fireEvent.change(screen.getByRole('textbox', { name: 'Street' }), { target: { value: '1 Main Street' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Street' }), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ addressLine1: '1 Main Street' })))
  })

  it('clears an address custom value with Ctrl+Enter and leaves untouched keys out of the patch', async () => {
    const onUpdate = jest.fn(async () => undefined)
    renderWithProviders(
      <AddressTiles
        addresses={[{ id: 'address-1', addressLine1: '1 Main Street', customValues: { delivery_note: 'North gate', parked_field: 'Keep this' } }]}
        onCreate={() => {}}
        onUpdate={onUpdate}
        t={(_key, fallback) => fallback ?? ''}
        emptyLabel="No addresses"
        customFields={{
          structure: {
            entityId: 'customers:customer_address',
            status: 'ready',
            fields: [{ id: 'delivery_note', type: 'text', label: 'Delivery note' }],
            definitions: [{ key: 'delivery_note', kind: 'text' }],
            retry: () => {},
          },
          labels: { loading: 'Loading fields', error: 'Field error', retry: 'Retry' },
          renderValues: () => null,
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit address' }))
    const note = screen.getByRole('textbox', { name: 'Delivery note' })
    expect(note).toHaveValue('North gate')
    fireEvent.change(note, { target: { value: '' } })
    fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('address-1', expect.objectContaining({
      customValues: { delivery_note: null },
    })))
    expect(screen.queryByRole('textbox', { name: 'Delivery note' })).not.toBeInTheDocument()
  })
})
