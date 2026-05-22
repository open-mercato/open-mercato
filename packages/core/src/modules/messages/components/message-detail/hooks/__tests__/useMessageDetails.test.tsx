/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react'
import { useMessageDetails } from '../useMessageDetails'

const mockInvalidateQueries = jest.fn()
const mockUseAppEvent = jest.fn()
const mockRouterPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 'scope-1',
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: (...args: unknown[]) => mockUseAppEvent(...args),
}))

jest.mock('../useMessageDetailsQueries', () => ({
  useMessageDetailsQueries: () => ({
    detailQuery: { refetch: jest.fn() },
    detail: null,
    isLoadingDetail: false,
    loadErrorMessage: 'load error',
    attachmentsQuery: { isLoading: false },
    attachments: [],
    refreshDetailWithoutAutoMarkRead: jest.fn(),
    listItemComponentKey: null,
    contentComponentKey: null,
    actionsComponentKey: null,
  }),
}))

jest.mock('../useMessageDetailsActions', () => ({
  useMessageDetailsActions: () => ({
    updatingState: false,
    executingActionId: null,
    pendingActionConfirmation: null,
    deleteConfirmationOpen: false,
    activeConversationAction: null,
    setEditOpen: jest.fn(),
    setDeleteConfirmationOpen: jest.fn(),
    handleDelete: jest.fn(),
    handleDeleteDialogKeyDown: jest.fn(),
    handleExecuteAction: jest.fn(),
    handleExecuteActionById: jest.fn(),
    handleConfirmPendingAction: jest.fn(),
    handleActionConfirmDialogKeyDown: jest.fn(),
    archiveConversation: jest.fn(),
    markConversationUnread: jest.fn(),
    deleteConversation: jest.fn(),
    setPendingActionConfirmation: jest.fn(),
  }),
}))

jest.mock('../useMessageDetailsConversation', () => ({
  useMessageDetailsConversation: () => ({
    conversationItems: [],
    forcedExpandedItemId: null,
    isConversationItemExpanded: jest.fn(),
    toggleConversationItem: jest.fn(),
    buildConversationListItemMessage: jest.fn(),
    contentProps: {},
    messageActions: [],
    objectActionsByObjectId: {},
    contentComponentKey: null,
  }),
}))

describe('useMessageDetails', () => {
  beforeEach(() => {
    mockInvalidateQueries.mockReset()
    mockUseAppEvent.mockReset()
    mockRouterPush.mockReset()
  })

  it('invalidates the message list cache when a message event arrives', () => {
    renderHook(() => useMessageDetails('message-1'))

    const messageEventRegistration = mockUseAppEvent.mock.calls.find(
      ([eventName]) => eventName === 'messages.message.*',
    )

    expect(messageEventRegistration).toBeTruthy()

    const [, handler] = messageEventRegistration as [
      string,
      (event: { payload?: Record<string, unknown> }) => void,
    ]

    act(() => {
      handler({ payload: { messageId: 'message-2' } })
    })

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages', 'list'] })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages', 'detail', 'message-1'] })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages', 'detail', 'message-2'] })
  })
})
