/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { I18nProvider, type Dict } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import english from '../../i18n/en.json'
import polish from '../../i18n/pl.json'
import {
  useMessagesInboxBulkActions,
  type MessageFolder,
} from '../useMessagesInboxBulkActions'

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(async () => true),
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
    jest.mocked(flash).mockClear()
  })

  function bulkActionsFor(folder: MessageFolder, locale: Locale = 'en', dict: Dict = {}) {
    const { result } = renderHook(
      () => useMessagesInboxBulkActions({ folder, page: 1, search: '', filterValues: {} }),
      {
        wrapper: ({ children }) => (
          <I18nProvider locale={locale} dict={dict}>{children}</I18nProvider>
        ),
      },
    )

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

  it.each([
    [1, 'Usunięto 1 wiadomość.'],
    [2, 'Usunięto 2 wiadomości.'],
    [5, 'Usunięto 5 wiadomości.'],
    [12, 'Usunięto 12 wiadomości.'],
    [22, 'Usunięto 22 wiadomości.'],
  ])('shows the Polish confirmation after deleting %i messages', async (count, message) => {
    const deleteAction = bulkActionsFor('inbox', 'pl', polish).find((action) => action.id === 'messages-delete')
    const rows = Array.from({ length: count }, (_, index) => ({ id: `msg-${index}` }))

    expect(await deleteAction?.onExecute(rows)).toBe(true)
    expect(apiCallMock).toHaveBeenCalledTimes(count)
    expect(flash).toHaveBeenCalledWith(message, 'success')
  })

  it('uses the localized base key for an app locale without plural variants', async () => {
    const deleteAction = bulkActionsFor('inbox', 'cs' as Locale, {
      ...english,
      'messages.bulk.flash.deleteSuccess': 'Odstraněné zprávy: {count}.',
    }).find((action) => action.id === 'messages-delete')

    expect(await deleteAction?.onExecute([{ id: 'msg-1' }])).toBe(true)
    expect(flash).toHaveBeenCalledWith('Odstraněné zprávy: 1.', 'success')
  })
})
