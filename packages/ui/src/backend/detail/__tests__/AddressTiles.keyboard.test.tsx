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
  default: ({ value, onChange }: { value: AddressEditorDraft; onChange: (next: AddressEditorDraft) => void }) => (
    <>
      <input aria-label="Label" value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} />
      <input aria-label="Street" value={value.addressLine1} onChange={(event) => onChange({ ...value, addressLine1: event.target.value })} />
      <input aria-label="Nested selector" onKeyDown={(event) => event.preventDefault()} />
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
})
