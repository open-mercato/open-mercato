/**
 * @jest-environment jsdom
 */
import type React from 'react'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import DirectoryOrganizationsPage from '../page'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/i18n/context'),
  useT: () => mockTranslate,
}))

jest.mock('next/link', () => ({ children, href }: any) => <a href={href}>{children}</a>)

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: any) => <div>{children}</div>,
  PageBody: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: any) => (
    <div data-testid="data-table-mock">
      <div data-testid="data-table-title">{props.title}</div>
      <div data-testid="row-actions">
        {props.rowActions?.({
          id: 'org-1',
          name: 'Acme HQ',
          depth: 0,
          updatedAt: '2024-05-06T07:08:09.000Z',
        })}
      </div>
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({
  ListEmptyState: () => null,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: any) => (
    <div>
      {items.map((item: any) => (
        <button key={item.id} data-testid={`row-action-${item.id}`} onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/ValueIcons', () => ({
  BooleanIcon: ({ value }: { value: boolean }) => <span>{String(value)}</span>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild, ...rest }: any) =>
    asChild ? <span {...rest}>{children}</span> : <button {...rest}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: jest.fn(() => ({ 'x-expected-updated-at': 'header' })),
}))

const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const retryLastMutationMock = jest.fn(async () => true)
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (input: { operation: () => Promise<unknown> }) => runMutationMock(input),
    retryLastMutation: retryLastMutationMock,
  }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: jest.fn().mockReturnValue(1),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(() => Promise.resolve(true)),
    ConfirmDialogElement: null,
  }),
}))

const { readApiResultOrThrow } = jest.requireMock('@open-mercato/ui/backend/utils/apiCall') as {
  readApiResultOrThrow: jest.Mock
}

describe('DirectoryOrganizationsPage delete', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runMutationMock.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
    ;(surfaceRecordConflict as jest.Mock).mockReturnValue(false)
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, result: { ok: true, granted: ['directory.organizations.manage'] } })
    readApiResultOrThrow.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })
    ;(apiCallOrThrow as jest.Mock).mockResolvedValue({ ok: true })
  })

  it('routes the delete through useGuardedMutation with stable context and the row lock header', async () => {
    renderWithProviders(<DirectoryOrganizationsPage />)
    const deleteButton = await screen.findByTestId('row-action-delete')

    fireEvent.click(deleteButton)

    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))
    const input = runMutationMock.mock.calls[0][0]
    expect(input.context).toEqual(
      expect.objectContaining({
        formId: 'directory-organizations-list:single-delete',
        resourceKind: 'directory.organization',
        resourceId: 'org-1',
        retryLastMutation: retryLastMutationMock,
      }),
    )

    await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalled())
    expect(buildOptimisticLockHeader).toHaveBeenCalledWith('2024-05-06T07:08:09.000Z')
    const deleteCall = (apiCallOrThrow as jest.Mock).mock.calls[0]
    expect(deleteCall[0]).toBe('/api/directory/organizations?id=org-1')
    expect(deleteCall[1]).toEqual(expect.objectContaining({ method: 'DELETE' }))
    expect(flash).toHaveBeenCalledWith('Organization deleted', 'success')
  })

  it('surfaces a stale-record 409 conflict through the shared conflict path and skips the generic flash', async () => {
    const conflict = Object.assign(new Error('record_modified'), { status: 409 })
    ;(apiCallOrThrow as jest.Mock).mockRejectedValue(conflict)
    ;(surfaceRecordConflict as jest.Mock).mockReturnValue(true)

    renderWithProviders(<DirectoryOrganizationsPage />)
    const deleteButton = await screen.findByTestId('row-action-delete')

    fireEvent.click(deleteButton)

    await waitFor(() => expect(surfaceRecordConflict).toHaveBeenCalledWith(conflict, expect.any(Function)))
    expect(flash).not.toHaveBeenCalledWith('Organization deleted', 'success')
    expect(flash).not.toHaveBeenCalledWith(expect.stringContaining('Failed'), 'error')
  })

  it('falls back to a generic error flash for non-conflict failures', async () => {
    const failure = new Error('boom')
    ;(apiCallOrThrow as jest.Mock).mockRejectedValue(failure)
    ;(surfaceRecordConflict as jest.Mock).mockReturnValue(false)

    renderWithProviders(<DirectoryOrganizationsPage />)
    const deleteButton = await screen.findByTestId('row-action-delete')

    fireEvent.click(deleteButton)

    await waitFor(() => expect(flash).toHaveBeenCalledWith('boom', 'error'))
  })
})
