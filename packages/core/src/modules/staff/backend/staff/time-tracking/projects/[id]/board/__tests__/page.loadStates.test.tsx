/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import ProjectBoardPage from '../page'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('../../../../../../../lib/time-tracking-ui/TaskBoardScreen', () => ({
  TaskBoardScreen: ({ projectName }: { projectName: string }) => <div>{projectName}</div>,
}))
jest.mock('../../../../../../../lib/time-tracking-ui/NoProjectAccess', () => ({
  NoProjectAccess: () => <div>Access request screen</div>,
}))

const apiCallMock = jest.mocked(apiCall)

function response(status: number, result: Record<string, unknown>) {
  return { ok: status >= 200 && status < 300, status, result, response: new Response(null, { status }) }
}

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ProjectBoardPage params={{ id: PROJECT_ID }} />
    </QueryClientProvider>,
  )
}

beforeEach(() => jest.clearAllMocks())

describe('project board load states', () => {
  it.each([
    response(200, { items: [] }),
    response(404, { error: 'Not found' }),
  ])('shows a missing project with a way back for status $status', async (reply) => {
    apiCallMock.mockResolvedValue(reply)
    renderBoard()

    expect(await screen.findByText('Project not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to projects' })).toHaveAttribute(
      'href', '/backend/staff/time-tracking/projects',
    )
    expect(screen.queryByText('Access request screen')).not.toBeInTheDocument()
  })

  it('offers retry after a server error and loads the project on retry', async () => {
    apiCallMock
      .mockResolvedValueOnce(response(500, { error: 'Internal server error' }))
      .mockResolvedValueOnce(response(200, { items: [{ id: PROJECT_ID, name: 'Recovered project' }] }))
    renderBoard()

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load project.')
    expect(screen.queryByText('Access request screen')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Recovered project')).toBeInTheDocument()
    expect(apiCallMock).toHaveBeenCalledTimes(2)
  })

  it('offers retry after a network failure without showing a raw browser message', async () => {
    apiCallMock.mockRejectedValue(new TypeError('Failed to fetch'))
    renderBoard()

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load project.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
    expect(screen.queryByText('Access request screen')).not.toBeInTheDocument()
  })

  it('shows the access request screen only for an explicit project access denial', async () => {
    apiCallMock.mockResolvedValue(response(404, { reason: 'no_project_access' }))
    renderBoard()

    expect(await screen.findByText('Access request screen')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Project not found.')).not.toBeInTheDocument()
  })

  it('does not offer an access request for an unrelated forbidden response', async () => {
    apiCallMock.mockResolvedValue(response(403, { error: 'Forbidden' }))
    renderBoard()

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load project.')
    expect(screen.queryByText('Access request screen')).not.toBeInTheDocument()
  })
})
