/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { TimeEntryProjectField, type TimeEntryProjectFieldProps } from '../TimeEntryProjectField'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>

function directory(items: Array<Record<string, unknown>>) {
  return { ok: true, status: 200, result: { items, total: items.length }, response: {} as Response, cacheStatus: null }
}

beforeEach(() => {
  mockApiCall.mockReset()
  mockApiCall.mockResolvedValue(directory([{ id: '33333333-3333-4333-8333-333333333333', name: 'Wdrożenie B2B' }]) as never)
})

function renderField(overrides: Partial<TimeEntryProjectFieldProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const props: TimeEntryProjectFieldProps = {
    value: null,
    onChange: jest.fn(),
    knownProjects: new Map(),
    knownProjectsPending: false,
    onProjectsResolved: jest.fn(),
    queryKeyPrefix: ['test', 'project'],
    error: null,
    disabled: false,
    triggerRef: React.createRef<HTMLDivElement>(),
    ...overrides,
  }
  render(
    <QueryClientProvider client={queryClient}>
      <TimeEntryProjectField {...props} />
    </QueryClientProvider>,
  )
}

describe('TimeEntryProjectField accessibility (real ComboboxInput)', () => {
  it('names the required combobox by its label', async () => {
    renderField()
    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())

    const combobox = screen.getByRole('combobox', { name: 'Project' })
    expect(combobox).toBeRequired()
    expect(combobox).not.toHaveAttribute('aria-invalid')
    expect(combobox).not.toHaveAttribute('aria-describedby')
  })

  it('marks the combobox invalid and describes it by the validation message', () => {
    renderField({ error: 'Pick the project this time belongs to.' })

    const combobox = screen.getByRole('combobox', { name: 'Project' })
    expect(combobox).toHaveAttribute('aria-invalid', 'true')
    expect(combobox).toHaveAccessibleDescription('Pick the project this time belongs to.')
  })

  it('describes the combobox by the empty state when no project is reachable', async () => {
    mockApiCall.mockResolvedValue(directory([]) as never)
    renderField()

    const combobox = screen.getByRole('combobox', { name: 'Project' })
    await waitFor(() => expect(combobox).toHaveAccessibleDescription('No projects you can log time to.'))
    expect(screen.getByText('No projects you can log time to.')).toBeVisible()
  })
})
