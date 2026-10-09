/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { TimeEntryProjectField, type TimeEntryProjectFieldProps } from '../TimeEntryProjectField'
import type { ProjectOption } from '../timeEntryDialogState'

const PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const HIDDEN_PROJECT_ID = '99999999-9999-4999-8999-999999999999'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

type ComboboxProps = {
  value: string
  onChange: (next: string) => void
  seedOptions?: Array<{ value: string; label: string; description?: string | null }>
  loadSuggestions?: (query?: string) => Promise<Array<{ value: string; label: string; description?: string | null }>>
  resolveLabel?: (value: string) => string | Promise<string>
  disabled?: boolean
}

let lastComboboxProps: ComboboxProps | null = null

/** The typeahead itself is tested in `packages/ui`; here only the contract the field hands it matters. */
jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => {
  const ReactModule = jest.requireActual('react') as typeof React
  const ComboboxInput = (props: ComboboxProps) => {
    const [label, setLabel] = ReactModule.useState('')
    ReactModule.useEffect(() => {
      lastComboboxProps = props
    })
    ReactModule.useEffect(() => {
      if (!props.value || !props.resolveLabel) return
      void Promise.resolve(props.resolveLabel(props.value)).then(setLabel)
    }, [props.value, props.resolveLabel])
    return ReactModule.createElement('div', null, [
      ReactModule.createElement('input', { key: 'input', 'data-testid': 'project-input', disabled: props.disabled }),
      ReactModule.createElement('span', { key: 'label', 'data-testid': 'project-label' }, label),
      ReactModule.createElement(
        'span',
        { key: 'seed', 'data-testid': 'project-seed' },
        (props.seedOptions ?? []).map((option) => option.label).join('|'),
      ),
    ])
  }
  return { __esModule: true, ComboboxInput }
})

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>

function ok<T>(result: T) {
  return { ok: true, status: 200, result, response: {} as Response, cacheStatus: null }
}

function notFound() {
  return { ok: false, status: 404, result: { error: 'Not found' }, response: {} as Response, cacheStatus: null }
}

const projectRow = {
  id: PROJECT_ID,
  name: 'Wdrożenie B2B',
  customer_snapshot: { name: 'Acme' },
  hourly_rate: 150,
  currency_code: 'PLN',
}

function renderField(overrides: Partial<TimeEntryProjectFieldProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onProjectsResolved = jest.fn<void, [ProjectOption[]]>()
  const props: TimeEntryProjectFieldProps = {
    value: null,
    onChange: jest.fn(),
    knownProjects: new Map(),
    knownProjectsPending: false,
    onProjectsResolved,
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
  return { props, onProjectsResolved }
}

beforeEach(() => {
  lastComboboxProps = null
  mockApiCall.mockReset()
  mockApiCall.mockResolvedValue(notFound() as never)
})

describe('TimeEntryProjectField', () => {
  it('searches active projects by the trimmed term and reports what it found', async () => {
    mockApiCall.mockResolvedValue(ok({ items: [projectRow], total: 1 }) as never)
    const { onProjectsResolved } = renderField()

    const options = await lastComboboxProps!.loadSuggestions!('  Wdro  ')

    const url = String(mockApiCall.mock.calls[0][0])
    expect(url).toContain('/api/staff/timesheets/time-projects?')
    expect(url).toContain('status=active')
    expect(url).toContain('q=Wdro')
    expect(url).toContain('pageSize=50')
    expect(options).toEqual([{ value: PROJECT_ID, label: 'Wdrożenie B2B', description: 'Acme' }])
    expect(onProjectsResolved).toHaveBeenCalledWith([expect.objectContaining({ id: PROJECT_ID, hourlyRate: 150 })])
  })

  it('returns no options when the search fails', async () => {
    renderField()

    await expect(lastComboboxProps!.loadSuggestions!('x')).resolves.toEqual([])
  })

  it('labels a known project without a request', async () => {
    const known: ProjectOption = {
      id: PROJECT_ID,
      name: 'Wdrożenie B2B',
      customerName: 'Acme',
      hourlyRate: 150,
      currencyCode: 'PLN',
      billableByDefault: null,
    }
    renderField({ value: PROJECT_ID, knownProjects: new Map([[PROJECT_ID, known]]) })

    await waitFor(() => expect(screen.getByTestId('project-label').textContent).toBe('Wdrożenie B2B'))
    expect(screen.getByTestId('project-seed').textContent).toBe('Wdrożenie B2B')
    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('looks up a selected project beyond the first page by id and reports it', async () => {
    mockApiCall.mockResolvedValue(ok({ items: [projectRow], total: 1 }) as never)
    const { onProjectsResolved } = renderField({ value: PROJECT_ID })

    await waitFor(() => expect(screen.getByTestId('project-label').textContent).toBe('Wdrożenie B2B'))
    expect(mockApiCall.mock.calls.every(([url]) => String(url).includes(`ids=${PROJECT_ID}`))).toBe(true)
    expect(onProjectsResolved).toHaveBeenCalledWith([expect.objectContaining({ id: PROJECT_ID })])
  })

  it('shows the fallback label, not an error, for a project the caller cannot see', async () => {
    const { onProjectsResolved } = renderField({ value: HIDDEN_PROJECT_ID })

    await waitFor(() => expect(screen.getByTestId('project-label').textContent).toBe('Project not available'))
    await waitFor(() => expect(screen.getByTestId('project-seed').textContent).toBe('Project not available'))
    expect(onProjectsResolved).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders a server or validation error under the field and disables it when locked', () => {
    renderField({ error: 'Pick the project this time belongs to.', disabled: true })

    expect(screen.getByRole('alert').textContent).toBe('Pick the project this time belongs to.')
    expect(screen.getByTestId('entry-dialog-project').getAttribute('aria-invalid')).toBe('true')
    expect((screen.getByTestId('project-input') as HTMLInputElement).disabled).toBe(true)
  })
})
