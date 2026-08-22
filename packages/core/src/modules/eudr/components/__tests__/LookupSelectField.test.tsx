/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { LookupSelectField, type PickerOption } from '../formConfig'

type TestSnapshot = { displayName?: string }

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const stableTranslate = (key: string) => key
  return { useT: () => stableTranslate }
})

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  LookupSelect: ({ value, onChange }: { value: string | null; onChange: (next: string | null) => void }) => (
    <button type="button" data-testid="picker" data-value={value ?? ''} onClick={() => onChange('company-2')}>
      pick
    </button>
  ),
}))

const OPTIONS: Record<string, PickerOption<TestSnapshot>> = {
  'company-1': { value: 'company-1', label: 'Acme', snapshot: { displayName: 'Acme' } },
  'company-2': { value: 'company-2', label: 'Globex', snapshot: { displayName: 'Globex' } },
}

function Harness({ initialValue, onSnapshot }: { initialValue: string | null; onSnapshot: (snapshot: TestSnapshot | null) => void }) {
  const [value, setValue] = React.useState<string | null>(initialValue)
  return (
    <LookupSelectField<TestSnapshot>
      id="supplierEntityId"
      value={value}
      onChange={(next) => setValue(next ?? '')}
      onSnapshot={onSnapshot}
      placeholder="placeholder"
      loadError="loadError"
      loadOptions={async () => Object.values(OPTIONS)}
      loadSelectedOption={async (id) => OPTIONS[id] ?? null}
    />
  )
}

describe('LookupSelectField snapshot emission', () => {
  it('does not emit a snapshot while resolving the value the form was hydrated with', async () => {
    const onSnapshot = jest.fn()
    render(<Harness initialValue="company-1" onSnapshot={onSnapshot} />)

    await waitFor(() => {
      expect(screen.getByText('Acme')).toBeInTheDocument()
    })
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it('emits the snapshot once the user picks a different record', async () => {
    const onSnapshot = jest.fn()
    render(<Harness initialValue="company-1" onSnapshot={onSnapshot} />)

    await waitFor(() => {
      expect(screen.getByText('Acme')).toBeInTheDocument()
    })

    await act(async () => {
      screen.getByTestId('picker').click()
    })

    await waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledWith({ displayName: 'Globex' })
    })
  })

  it('emits the snapshot on a create flow that starts without a value', async () => {
    const onSnapshot = jest.fn()
    render(<Harness initialValue={null} onSnapshot={onSnapshot} />)

    await act(async () => {
      screen.getByTestId('picker').click()
    })

    await waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledWith({ displayName: 'Globex' })
    })
  })
})
