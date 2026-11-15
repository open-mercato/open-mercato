/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { TaskPicker, type TaskPickerItem } from '../TaskPicker'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

const items: TaskPickerItem[] = [
  {
    id: 'task-1',
    reference: 'AWR-6',
    title: 'Migracja koszyka B2B',
    projectId: 'project-1',
    projectName: 'migracja B2B',
    customerName: 'Nordvik',
    statusId: null,
    assigneeInitials: null,
    assigneeName: null,
    loggedMinutes: null,
  },
]

/**
 * The picker is nearly always dropped inside a dialog, and Escape has to mean
 * "close the list" there — not "close the form and lose the entry". Radix
 * dismisses on a *document capture* listener, so this is only observable with a
 * real Dialog around the picker; a bare render would pass either way.
 */
function PickerInDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [value, setValue] = React.useState<string | null>(null)
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-testid="host-dialog">
        <DialogTitle>Time entry</DialogTitle>
        <TaskPicker value={value} onChange={setValue} items={items} />
      </DialogContent>
    </Dialog>
  )
}

describe('TaskPicker — Escape inside a dialog', () => {
  // The picker keeps the active row in view; jsdom has no layout, so the call
  // has to exist for the list to render at all.
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('closes its own list and leaves the dialog open', async () => {
    const onOpenChange = jest.fn()
    render(<PickerInDialog onOpenChange={onOpenChange} />)

    fireEvent.focus(screen.getByTestId('task-picker-input'))
    expect(await screen.findByTestId('task-picker-option-task-1')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByTestId('task-picker-input'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByTestId('task-picker-option-task-1')).not.toBeInTheDocument())
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('host-dialog')).toBeInTheDocument()
  })

  it('lets Escape through to the dialog once the list is closed', async () => {
    const onOpenChange = jest.fn()
    render(<PickerInDialog onOpenChange={onOpenChange} />)

    fireEvent.focus(screen.getByTestId('task-picker-input'))
    fireEvent.keyDown(screen.getByTestId('task-picker-input'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('task-picker-option-task-1')).not.toBeInTheDocument())

    fireEvent.keyDown(screen.getByTestId('task-picker-input'), { key: 'Escape' })

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('reports the typed term so the host can search beyond what it was given', () => {
    const onQueryChange = jest.fn()
    render(
      <TaskPicker value={null} onChange={jest.fn()} items={items} onQueryChange={onQueryChange} />,
    )

    fireEvent.change(screen.getByTestId('task-picker-input'), { target: { value: 'AWR-412' } })

    expect(onQueryChange).toHaveBeenCalledWith('AWR-412')
  })

  it('says it is still looking rather than "nothing matches" while a remote search runs', () => {
    render(
      <TaskPicker value={null} onChange={jest.fn()} items={[]} searching autoFocus />,
    )

    fireEvent.focus(screen.getByTestId('task-picker-input'))
    fireEvent.change(screen.getByTestId('task-picker-input'), { target: { value: 'kwartalnych' } })

    expect(screen.getByText('Loading tasks…')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument()
  })
})
