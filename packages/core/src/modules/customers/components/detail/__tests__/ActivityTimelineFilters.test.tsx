/**
 * @jest-environment jsdom
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivityTimelineFilters } from '../ActivityTimelineFilters'

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

const baseProps = {
  entityId: 'person-123',
  dateFrom: '',
  dateTo: '',
  onDateFromChange: jest.fn(),
  onDateToChange: jest.fn(),
  onReset: jest.fn(),
}

beforeEach(() => {
  readApiResultOrThrowMock.mockReset()
  readApiResultOrThrowMock.mockResolvedValue({ call: 18, email: 4, meeting: 2, note: 0, total: 24 })
})

describe('ActivityTimelineFilters', () => {
  it('marks "All Activities" active when no type is selected', async () => {
    renderWithProviders(
      <ActivityTimelineFilters {...baseProps} activeTypes={[]} onTypesChange={jest.fn()} />,
    )

    const allChip = screen.getByRole('button', { name: /all activities/i })
    expect(allChip.getAttribute('aria-pressed')).toBe('true')

    const callChip = screen.getByRole('button', { name: /^call/i })
    expect(callChip.getAttribute('aria-pressed')).toBe('false')
  })

  it('marks "All Activities" inactive when at least one type is selected', async () => {
    renderWithProviders(
      <ActivityTimelineFilters {...baseProps} activeTypes={['call']} onTypesChange={jest.fn()} />,
    )

    expect(screen.getByRole('button', { name: /all activities/i }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: /^call/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('clicking "All Activities" clears the active type filter', async () => {
    const onTypesChange = jest.fn()
    renderWithProviders(
      <ActivityTimelineFilters {...baseProps} activeTypes={['call', 'email']} onTypesChange={onTypesChange} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /all activities/i }))
    expect(onTypesChange).toHaveBeenCalledWith([])
  })

  it('appends the count to the chip label when counts > 0 are returned', async () => {
    renderWithProviders(
      <ActivityTimelineFilters {...baseProps} activeTypes={[]} onTypesChange={jest.fn()} />,
    )

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/customers/interactions/counts?entityId=person-123'),
        expect.any(Object),
      )
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /call 18/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /email 4/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /meeting 2/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^note$/i })).toBeInTheDocument()
  })

  it('toggling a type chip calls onTypesChange with the new selection', async () => {
    const onTypesChange = jest.fn()
    const { rerender } = renderWithProviders(
      <ActivityTimelineFilters {...baseProps} activeTypes={[]} onTypesChange={onTypesChange} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^call/i }))
    expect(onTypesChange).toHaveBeenLastCalledWith(['call'])

    rerender(<ActivityTimelineFilters {...baseProps} activeTypes={['call']} onTypesChange={onTypesChange} />)

    fireEvent.click(screen.getByRole('button', { name: /^call/i }))
    expect(onTypesChange).toHaveBeenLastCalledWith([])
  })
})
