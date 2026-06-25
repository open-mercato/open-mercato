/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { FieldRegistry } from '@open-mercato/ui/backend/fields/registry'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useDictionaryEntries } from '../../components/hooks/useDictionaryEntries'
import '../dictionary'

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/i18n/context')
  return {
    ...actual,
    useT: () => (key: string, fallback?: string) => fallback ?? key,
  }
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../../components/hooks/useDictionaryEntries', () => ({
  useDictionaryEntries: jest.fn(),
  ensureDictionaryEntries: jest.fn(),
  invalidateDictionaryEntries: jest.fn(),
}))

jest.mock('@open-mercato/ui/primitives/select', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return {
    Select: Passthrough,
    SelectContent: Passthrough,
    SelectItem: Passthrough,
    SelectTrigger: Passthrough,
    SelectValue: () => null,
  }
})

const apiCallMock = apiCall as unknown as jest.Mock
const useDictionaryEntriesMock = useDictionaryEntries as unknown as jest.Mock

function renderEditor(def: unknown, onChange: (patch: unknown) => void = jest.fn()) {
  const defEditor = FieldRegistry.getDefEditor('dictionary')
  if (!defEditor) throw new Error('dictionary field defEditor not registered')
  render(<>{defEditor({ def, onChange })}</>)
  return { onChange }
}

describe('dictionary field defEditor', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    useDictionaryEntriesMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [] } })
    useDictionaryEntriesMock.mockReturnValue({ data: { entries: [] }, isLoading: false })
  })

  it('renders the shared Checkbox primitive instead of a native checkbox input', async () => {
    renderEditor({ configJson: { dictionaryId: 'dict-1', dictionaryInlineCreate: true } })

    const checkbox = await screen.findByLabelText('Allow inline creation inside forms')
    expect(checkbox.tagName).toBe('BUTTON')
    expect(checkbox).toHaveAttribute('data-state', 'checked')
  })

  it('toggles dictionaryInlineCreate through the Checkbox primitive', async () => {
    const onChange = jest.fn()
    renderEditor({ configJson: { dictionaryId: 'dict-1', dictionaryInlineCreate: true } }, onChange)

    const checkbox = await screen.findByLabelText('Allow inline creation inside forms')
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith({ dictionaryInlineCreate: false })
  })

  it('disables the inline-create checkbox until a dictionary is selected', async () => {
    renderEditor({ configJson: {} })

    const checkbox = await screen.findByLabelText('Allow inline creation inside forms')
    expect(checkbox).toBeDisabled()
  })

  it('toggles multi-value dictionary fields and clears scalar defaults', async () => {
    const onChange = jest.fn()
    renderEditor({ configJson: { dictionaryId: 'dict-1', defaultValue: 'north' } }, onChange)

    const checkbox = await screen.findByLabelText('Allow selecting multiple entries')
    expect(checkbox).toHaveAttribute('data-state', 'unchecked')

    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith({ multi: true, defaultValue: undefined })
  })

  it('uses the design-system error token (not text-red-600) for load failures', async () => {
    apiCallMock.mockResolvedValue({ ok: false, result: { error: 'boom' } })
    renderEditor({ configJson: {} })

    const message = await screen.findByText(/Failed to load dictionaries/)
    expect(message).toHaveClass('text-status-error-text')
    expect(message).not.toHaveClass('text-red-600')
  })

  it('uses the design-system warning token (not text-amber-600) for a stale default value', async () => {
    useDictionaryEntriesMock.mockReturnValue({
      data: { entries: [{ value: 'a', label: 'A' }] },
      isLoading: false,
    })
    renderEditor({ configJson: { dictionaryId: 'dict-1', defaultValue: 'missing' } })

    const message = await screen.findByText(/Default entry not found/)
    expect(message).toHaveClass('text-status-warning-text')
    expect(message).not.toHaveClass('text-amber-600')
  })
})
