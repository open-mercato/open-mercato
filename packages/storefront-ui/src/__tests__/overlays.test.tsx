import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog } from '../primitives/dialog'
import { Sheet } from '../primitives/sheet'
import { Tabs } from '../primitives/tabs'
import { Toast } from '../primitives/toast'
import { Alert } from '../primitives/alert'
import { Button } from '../primitives/button'

describe('Dialog keyboard contract', () => {
  it('activates the primary action on Cmd/Ctrl+Enter and closes on Escape', async () => {
    const onPrimary = jest.fn()
    const onOpenChange = jest.fn()
    render(
      <Dialog defaultOpen onOpenChange={onOpenChange}>
        <Dialog.Content closeLabel="Close">
          <Dialog.Header><Dialog.Title>Delete?</Dialog.Title><Dialog.Description>Gone for good.</Dialog.Description></Dialog.Header>
          <Dialog.Footer>
            <Button variant="outline">Cancel</Button>
            <Button data-dialog-primary onClick={onPrimary}>Delete</Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Delete?' })
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(onPrimary).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(dialog).not.toBeInTheDocument()
  })
})

describe('Tabs', () => {
  it('moves selection with arrow keys and exposes tab semantics', async () => {
    render(
      <Tabs defaultValue="all">
        <Tabs.List aria-label="Orders">
          <Tabs.Trigger value="all">All</Tabs.Trigger>
          <Tabs.Trigger value="active">Active</Tabs.Trigger>
          <Tabs.Trigger value="past">Past</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="all">All orders</Tabs.Content>
        <Tabs.Content value="active">Active orders</Tabs.Content>
        <Tabs.Content value="past">Past orders</Tabs.Content>
      </Tabs>,
    )
    const all = screen.getByRole('tab', { name: 'All' })
    expect(all).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('All orders')
    all.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Active' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Active orders')
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Past' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('Toast', () => {
  function Trigger() {
    const { toast } = Toast.useToast()
    return <Button onClick={() => toast({ title: 'Added to cart', action: { label: 'Undo', onClick: () => {} } })}>Add</Button>
  }

  it('renders a status region with an action and dismisses', async () => {
    render(<Toast.Provider dismissLabel="Dismiss"><Trigger /></Toast.Provider>)
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('status')).toHaveTextContent('Added to cart')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps at most the configured number of toasts', async () => {
    function Many() {
      const { toast } = Toast.useToast()
      return <Button onClick={() => { toast({ title: 'One' }); toast({ title: 'Two' }); toast({ title: 'Three' }) }}>Burst</Button>
    }
    render(<Toast.Provider dismissLabel="Dismiss" limit={2}><Many /></Toast.Provider>)
    await userEvent.click(screen.getByRole('button', { name: 'Burst' }))
    expect(screen.getAllByRole('status')).toHaveLength(2)
    expect(screen.queryByText('One')).toBeNull()
  })
})

describe('Alert', () => {
  it('announces errors assertively and everything else politely', () => {
    const { rerender } = render(<Alert status="error">Declined</Alert>)
    expect(screen.getByRole('alert')).toHaveTextContent('Declined')
    rerender(<Alert status="information">Held for 15 minutes</Alert>)
    expect(screen.getByRole('status')).toHaveTextContent('Held for 15 minutes')
  })
})

describe('Dialog and Sheet used together', () => {
  it('keep their own parts although both build on the same Radix dialog', () => {
    expect(Dialog.Content).not.toBe(Sheet.Content)
    const dialog = render(<Dialog defaultOpen><Dialog.Content><Dialog.Header><Dialog.Title>Review</Dialog.Title></Dialog.Header></Dialog.Content></Dialog>)
    expect(screen.getByRole('dialog', { name: 'Review' })).toHaveAttribute('data-slot', 'dialog')
    dialog.unmount()
    render(<Sheet defaultOpen><Sheet.Content><Sheet.Header><Sheet.Title>Cart</Sheet.Title></Sheet.Header></Sheet.Content></Sheet>)
    expect(screen.getByRole('dialog', { name: 'Cart' })).toHaveAttribute('data-slot', 'sheet')
  })
})
