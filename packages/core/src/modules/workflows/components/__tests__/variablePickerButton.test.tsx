/**
 * @jest-environment jsdom
 *
 * Step 3.2 (workflows UX Phase 2a): the ledger-fed variable picker. The
 * popover lists the current step's ledger entries grouped by source kind with
 * type badges and `maybe` markers, a search input filters paths, clicking a
 * row splices `{{path}}` into the target control at the cursor (Input and
 * Textarea alike), non-insertable `'*'` wildcard entries are hidden, and an
 * empty ledger shows an i18n'd empty state while the button still renders.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { VariablePickerButton, type VariablePickerInsertMode } from '../fields/VariablePickerButton'
import type { LedgerEntry } from '../../lib/context-ledger'

const BUTTON_LABEL_KEY = 'workflows.variablePicker.buttonLabel'
const SEARCH_KEY = 'workflows.variablePicker.searchPlaceholder'
const EMPTY_STATE_KEY = 'workflows.variablePicker.emptyState'
const NO_MATCHES_KEY = 'workflows.variablePicker.noMatches'
const MAYBE_KEY = 'workflows.variablePicker.maybeBadge'
const GROUP_CONTEXT_SCHEMA_KEY = 'workflows.variablePicker.groups.contextSchema'
const GROUP_USER_TASK_KEY = 'workflows.variablePicker.groups.userTask'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  })
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
})

const sampleEntries: LedgerEntry[] = [
  {
    path: 'dealId',
    type: 'text',
    presence: 'always',
    source: { kind: 'contextSchema', label: 'contextSchema.input' },
    sample: 'deal_12345',
  },
  {
    path: 'score',
    type: 'number',
    presence: 'always',
    source: { kind: 'contextSchema', label: 'contextSchema.input' },
    sample: 0.92,
  },
  {
    path: 'notes',
    type: 'unknown',
    presence: 'maybe',
    source: { kind: 'userTask', stepId: 'review', label: 'userTask:review' },
  },
  {
    path: '*',
    type: 'unknown',
    presence: 'maybe',
    source: { kind: 'trigger', label: 'trigger:t1:payload' },
  },
]

function InputHarness({
  entries,
  onValueChange,
  initialValue = 'hello world',
  insertMode,
}: {
  entries?: LedgerEntry[]
  onValueChange: (nextValue: string) => void
  initialValue?: string
  insertMode?: VariablePickerInsertMode
}) {
  const [value, setValue] = React.useState(initialValue)
  const handleChange = (nextValue: string) => {
    setValue(nextValue)
    onValueChange(nextValue)
  }
  return (
    <div>
      <Input
        id="picker-target"
        type="text"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        aria-label="target"
      />
      <VariablePickerButton
        targetId="picker-target"
        value={value}
        onValueChange={handleChange}
        ledgerEntries={entries}
        insertMode={insertMode}
      />
    </div>
  )
}

function TextareaHarness({
  entries,
  onValueChange,
}: {
  entries?: LedgerEntry[]
  onValueChange: (nextValue: string) => void
}) {
  const [value, setValue] = React.useState('first line')
  const handleChange = (nextValue: string) => {
    setValue(nextValue)
    onValueChange(nextValue)
  }
  return (
    <div>
      <Textarea
        id="picker-target"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        aria-label="target"
      />
      <VariablePickerButton
        targetId="picker-target"
        value={value}
        onValueChange={handleChange}
        ledgerEntries={entries}
      />
    </div>
  )
}

function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: BUTTON_LABEL_KEY }))
}

describe('VariablePickerButton', () => {
  it('lists entries grouped by source kind with type badges, maybe markers, and samples', async () => {
    renderWithProviders(<InputHarness entries={sampleEntries} onValueChange={jest.fn()} />)

    openPicker()

    await waitFor(() => {
      expect(screen.getByText(GROUP_CONTEXT_SCHEMA_KEY)).toBeInTheDocument()
    })
    expect(screen.getByText(GROUP_USER_TASK_KEY)).toBeInTheDocument()
    expect(screen.getByText('dealId')).toBeInTheDocument()
    expect(screen.getByText('score')).toBeInTheDocument()
    expect(screen.getByText('notes')).toBeInTheDocument()
    expect(screen.getByText('text')).toBeInTheDocument()
    expect(screen.getByText('number')).toBeInTheDocument()
    expect(screen.getByText('unknown')).toBeInTheDocument()
    expect(screen.getByText(MAYBE_KEY)).toBeInTheDocument()
    expect(screen.getByText('deal_12345')).toBeInTheDocument()
    expect(screen.getByText('0.92')).toBeInTheDocument()
    expect(screen.queryByText('*')).not.toBeInTheDocument()
  })

  it('truncates long sample values to about forty characters', async () => {
    const longSampleEntries: LedgerEntry[] = [
      {
        path: 'summary',
        type: 'text',
        presence: 'always',
        source: { kind: 'contextSchema', label: 'contextSchema.input' },
        sample: 'x'.repeat(80),
      },
    ]
    renderWithProviders(<InputHarness entries={longSampleEntries} onValueChange={jest.fn()} />)

    openPicker()

    await waitFor(() => {
      expect(screen.getByText(`${'x'.repeat(39)}…`)).toBeInTheDocument()
    })
  })

  it('filters entries by the search input', async () => {
    renderWithProviders(<InputHarness entries={sampleEntries} onValueChange={jest.fn()} />)

    openPicker()
    await waitFor(() => {
      expect(screen.getByText('dealId')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(SEARCH_KEY), { target: { value: 'deal' } })

    expect(screen.getByText('dealId')).toBeInTheDocument()
    expect(screen.queryByText('score')).not.toBeInTheDocument()
    expect(screen.queryByText('notes')).not.toBeInTheDocument()
    expect(screen.queryByText(GROUP_USER_TASK_KEY)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(SEARCH_KEY), { target: { value: 'nothing-matches' } })
    expect(screen.getByText(NO_MATCHES_KEY)).toBeInTheDocument()
  })

  it('inserts {{path}} at the cursor position of an Input and closes', async () => {
    const onValueChange = jest.fn()
    renderWithProviders(<InputHarness entries={sampleEntries} onValueChange={onValueChange} />)

    const input = screen.getByLabelText('target') as HTMLInputElement
    input.focus()
    input.setSelectionRange(5, 5)

    openPicker()
    await waitFor(() => {
      expect(screen.getByText('dealId')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('dealId'))

    expect(onValueChange).toHaveBeenCalledWith('hello{{dealId}} world')
    await waitFor(() => {
      expect(screen.queryByText(GROUP_CONTEXT_SCHEMA_KEY)).not.toBeInTheDocument()
    })
  })

  it('inserts the bare dot path at the cursor when insertMode is bare', async () => {
    const onValueChange = jest.fn()
    renderWithProviders(
      <InputHarness
        entries={sampleEntries}
        onValueChange={onValueChange}
        initialValue=""
        insertMode="bare"
      />,
    )

    openPicker()
    await waitFor(() => {
      expect(screen.getByText('dealId')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('dealId'))

    expect(onValueChange).toHaveBeenCalledWith('dealId')
  })

  it('inserts {{path}} at the cursor position of a Textarea', async () => {
    const onValueChange = jest.fn()
    renderWithProviders(<TextareaHarness entries={sampleEntries} onValueChange={onValueChange} />)

    const textarea = screen.getByLabelText('target') as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(6, 10)

    openPicker()
    await waitFor(() => {
      expect(screen.getByText('notes')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('notes'))

    expect(onValueChange).toHaveBeenCalledWith('first {{notes}}')
  })

  it('renders the button and an empty state when no ledger entries are available', async () => {
    renderWithProviders(<InputHarness entries={undefined} onValueChange={jest.fn()} />)

    openPicker()

    await waitFor(() => {
      expect(screen.getByText(EMPTY_STATE_KEY)).toBeInTheDocument()
    })
  })

  it('shows the empty state when only wildcard entries exist', async () => {
    const wildcardOnly: LedgerEntry[] = [
      {
        path: '*',
        type: 'unknown',
        presence: 'maybe',
        source: { kind: 'trigger', label: 'trigger:t1:payload' },
      },
    ]
    renderWithProviders(<InputHarness entries={wildcardOnly} onValueChange={jest.fn()} />)

    openPicker()

    await waitFor(() => {
      expect(screen.getByText(EMPTY_STATE_KEY)).toBeInTheDocument()
    })
  })
})
