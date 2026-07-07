/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  useMessagesInboxBulkActions,
  type MessageFolder,
} from '../useMessagesInboxBulkActions'

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? '',
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: {} })),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(async (options: { operation: () => Promise<unknown> }) => options.operation()),
    retryLastMutation: jest.fn(),
  }),
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>

describe('useMessagesInboxBulkActions', () => {
  beforeEach(() => {
    apiCallMock.mockClear()
  })

  function bulkActionsFor(folder: MessageFolder) {
    const { result } = renderHook(() => useMessagesInboxBulkActions({
      folder,
      page: 1,
      search: '',
      filterValues: {},
    }))

    return result.current.bulkActions ?? []
  }

  function actionIdsFor(folder: MessageFolder): string[] {
    return bulkActionsFor(folder).map((action) => action.id)
  }

  it.each([
    ['inbox', ['messages-mark-read', 'messages-mark-unread', 'messages-archive', 'messages-delete']],
    ['archived', ['messages-mark-read', 'messages-mark-unread', 'messages-unarchive', 'messages-delete']],
    ['sent', ['messages-delete']],
    ['drafts', ['messages-delete']],
    ['all', []],
  ] satisfies Array<[MessageFolder, string[]]>)('exposes safe bulk actions in the %s folder', (folder, expectedIds) => {
    expect(actionIdsFor(folder)).toEqual(expectedIds)
  })

  it('routes the archived unarchive bulk action to DELETE /api/messages/{id}/archive', async () => {
    const unarchive = bulkActionsFor('archived').find((action) => action.id === 'messages-unarchive')
    expect(unarchive).toBeDefined()

    await unarchive!.onExecute([{ id: 'msg-1' }, { id: 'msg-2' }])

    expect(apiCallMock).toHaveBeenCalledWith('/api/messages/msg-1/archive', { method: 'DELETE' })
    expect(apiCallMock).toHaveBeenCalledWith('/api/messages/msg-2/archive', { method: 'DELETE' })
  })
})
