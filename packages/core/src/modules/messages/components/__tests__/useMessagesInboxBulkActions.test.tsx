/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react'
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

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(),
    retryLastMutation: jest.fn(),
  }),
}))

describe('useMessagesInboxBulkActions', () => {
  function actionIdsFor(folder: MessageFolder): string[] {
    const { result } = renderHook(() => useMessagesInboxBulkActions({
      folder,
      page: 1,
      search: '',
      filterValues: {},
    }))

    return result.current.bulkActions?.map((action) => action.id) ?? []
  }

  it.each([
    ['inbox', ['messages-mark-read', 'messages-mark-unread', 'messages-archive', 'messages-delete']],
    ['archived', ['messages-mark-read', 'messages-mark-unread', 'messages-delete']],
    ['sent', ['messages-delete']],
    ['drafts', ['messages-delete']],
    ['all', []],
  ] satisfies Array<[MessageFolder, string[]]>)('exposes safe bulk actions in the %s folder', (folder, expectedIds) => {
    expect(actionIdsFor(folder)).toEqual(expectedIds)
  })
})
