/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TimeEntryProjectField, type TimeEntryProjectFieldProps } from '../TimeEntryProjectField'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn().mockResolvedValue({ ok: true, status: 200, result: { items: [] } }),
}))

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
  it('names the required combobox by its label', () => {
    renderField()

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
})
