/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ProjectDefaultAssigneeField } from '../ProjectFormSections'
import { DEFAULT_ASSIGNEE_PAGE_SIZE } from '../projectDefaultAssignee'

const mockTranslate = (_key: string, fallback?: string) => fallback ?? ''

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(async (_headers: unknown, run: () => Promise<unknown>) => run()),
}))

jest.mock('@open-mercato/ui/primitives/select', () => {
  const ReactModule = jest.requireActual('react') as typeof React
  type SlotProps = { children?: React.ReactNode } & Record<string, unknown>
  const Passthrough = ({ children }: SlotProps) => ReactModule.createElement(ReactModule.Fragment, null, children)
  const SelectItem = ({ value, children }: SlotProps) =>
    ReactModule.createElement('option', { value: String(value) }, children)
  const Select = ({ value, children }: { value?: string; children?: React.ReactNode }) =>
    ReactModule.createElement('select', { 'data-testid': 'default-assignee-native', value: value ?? '', onChange: () => {} }, children)
  return {
    Select,
    SelectTrigger: () => null,
    SelectValue: Passthrough,
    SelectContent: Passthrough,
    SelectItem,
  }
})

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const SELECTED = '66666666-6666-4666-8666-666666666601'
const LOAD_FAILED = 'Could not load the project members, so the default assignee cannot be checked right now.'
const INACTIVE_WARNING = 'This member is no longer an active project member. New tickets will be left unassigned and the assigners notified.'

function response(ok: boolean, result: unknown, status = ok ? 200 : 500) {
  return { ok, status, result, response: {} as Response, cacheStatus: null } as never
}

function historicalPage() {
  return Array.from({ length: DEFAULT_ASSIGNEE_PAGE_SIZE }, (_, index) => ({
    staffMemberId: `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`,
    status: 'inactive',
  }))
}

let pageTwo: 'fail' | 'reject' | 'ok'

function installApi() {
  mockApiCall.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/employees?')) {
      const page = new URL(url, 'https://test.local').searchParams.get('page')
      if (page === '1') return response(true, { items: historicalPage(), totalPages: 2 })
      if (pageTwo === 'fail') return response(false, { error: 'Internal error' })
      if (pageTwo === 'reject') throw new Error('network down')
      return response(true, { items: [{ staffMemberId: SELECTED, status: 'active' }], totalPages: 2 })
    }
    if (url.includes('/timesheets/settings')) return response(true, { access: { assignmentGraceDays: 14 } })
    if (url.includes('/team-members?')) {
      return response(true, { items: [{ id: SELECTED, display_name: 'Anna Nowak' }] })
    }
    return response(true, { items: [] })
  })
}

function employeeFetches(page: string) {
  return mockApiCall.mock.calls.filter(([url]) => {
    const text = String(url)
    return text.includes('/employees?') && new URL(text, 'https://test.local').searchParams.get('page') === page
  }).length
}

beforeEach(() => {
  jest.clearAllMocks()
  pageTwo = 'ok'
  installApi()
})

describe('ProjectDefaultAssigneeField', () => {
  it('treats a failed later membership page as unknown and recovers on retry', async () => {
    pageTwo = 'fail'
    const onChange = jest.fn()
    render(<ProjectDefaultAssigneeField projectId={PROJECT_ID} value={SELECTED} onChange={onChange} />)

    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument()
    expect(screen.queryByText(INACTIVE_WARNING)).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    const select = screen.getByTestId('default-assignee-native') as HTMLSelectElement
    expect(select.value).toBe(SELECTED)
    expect(screen.queryByTestId('project-default-assignee-retry')).toBeInTheDocument()

    pageTwo = 'ok'
    fireEvent.click(screen.getByTestId('project-default-assignee-retry'))

    expect(await screen.findByRole('option', { name: 'Anna Nowak' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(LOAD_FAILED)).not.toBeInTheDocument())
    expect(screen.queryByText(INACTIVE_WARNING)).not.toBeInTheDocument()
    expect(employeeFetches('2')).toBe(2)
    expect(onChange).not.toHaveBeenCalled()
    expect((screen.getByTestId('default-assignee-native') as HTMLSelectElement).value).toBe(SELECTED)
  })

  it('treats a rejected membership request as unknown, not as an empty team', async () => {
    pageTwo = 'reject'
    render(<ProjectDefaultAssigneeField projectId={PROJECT_ID} value={SELECTED} onChange={jest.fn()} />)

    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument()
    expect(screen.queryByText(INACTIVE_WARNING)).not.toBeInTheDocument()
  })

  it('still warns about a selection that a complete read shows is no longer a member', async () => {
    render(<ProjectDefaultAssigneeField projectId={PROJECT_ID} value="66666666-6666-4666-8666-666666666699" onChange={jest.fn()} />)

    expect(await screen.findByText(INACTIVE_WARNING)).toBeInTheDocument()
    expect(screen.queryByText(LOAD_FAILED)).not.toBeInTheDocument()
  })
})
