/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { CustomerGroupParentField } from '../CustomerGroupParentField'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({
  ComboboxInput: ({ onChange }: { onChange: (next: string) => void }) => (
    <input data-testid="parent-combobox" onChange={(event) => onChange(event.target.value)} />
  ),
}))

const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>

describe('CustomerGroupParentField cycle check', () => {
  beforeEach(() => {
    mockReportError.mockReset()
    mockedApiCall.mockReset()
  })

  it('reports a failed cycle-check lookup and keeps the selection for server-side validation', async () => {
    mockedApiCall.mockRejectedValue(new Error('network down'))
    const setValue = jest.fn()
    render(<CustomerGroupParentField value="" setValue={setValue} excludeId="group-self" />)

    fireEvent.change(screen.getByTestId('parent-combobox'), { target: { value: 'group-parent' } })

    await waitFor(() => expect(setValue).toHaveBeenCalledWith('group-parent'))
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'customer_groups', code: 'customer_groups.parent_cycle_check_failed' }),
    )
    expect(screen.queryByText('A group cannot be moved under one of its own subgroups.')).toBeNull()
  })

  it('rejects a parent whose ancestor chain contains the edited group', async () => {
    mockedApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [{ id: 'group-parent', code: 'parent', name: 'Parent', parent_id: 'group-self' }] },
    } as Awaited<ReturnType<typeof apiCall>>)
    const setValue = jest.fn()
    render(<CustomerGroupParentField value="" setValue={setValue} excludeId="group-self" />)

    fireEvent.change(screen.getByTestId('parent-combobox'), { target: { value: 'group-parent' } })

    await waitFor(() =>
      expect(screen.getByText('A group cannot be moved under one of its own subgroups.')).toBeTruthy(),
    )
    expect(setValue).not.toHaveBeenCalled()
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('shows a loading indicator while the selected parent chain is being resolved', async () => {
    let resolveLookup: (value: Awaited<ReturnType<typeof apiCall>>) => void = () => {}
    mockedApiCall.mockReturnValue(
      new Promise((resolve) => {
        resolveLookup = resolve
      }),
    )
    render(<CustomerGroupParentField value="group-parent" setValue={jest.fn()} />)

    expect(screen.getByRole('status')).toBeTruthy()

    resolveLookup({
      ok: true,
      status: 200,
      result: { items: [{ id: 'group-parent', code: 'parent', name: 'Parent', parent_id: null }] },
    } as Awaited<ReturnType<typeof apiCall>>)

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })
})
