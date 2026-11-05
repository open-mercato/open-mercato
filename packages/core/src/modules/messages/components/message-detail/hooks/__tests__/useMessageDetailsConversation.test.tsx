/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react'
import { useMessageDetailsConversation } from '../useMessageDetailsConversation'
import type { MessageDetail } from '../../types'

const t = ((key: string, fallback?: string) => fallback ?? key) as never

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

function buildIngestedDetail(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: 'message-2',
    type: 'channel.email',
    isDraft: false,
    canEditDraft: false,
    canArchive: true,
    isArchived: false,
    senderUserId: SYSTEM_USER_ID,
    senderName: null,
    senderEmail: null,
    externalName: 'Jan Kowalski',
    externalEmail: 'jan@example.com',
    subject: 'Re: order 1234',
    body: 'newest reply',
    bodyFormat: 'text',
    priority: 'normal',
    sentAt: '2026-08-13T10:00:00.000Z',
    typeDefinition: {
      labelKey: 'messages.type.channelEmail',
      icon: 'mail',
      allowReply: true,
      allowForward: true,
    },
    recipients: [],
    objects: [],
    thread: [
      {
        id: 'message-1',
        senderUserId: SYSTEM_USER_ID,
        senderName: null,
        senderEmail: null,
        externalName: 'Jan Kowalski',
        externalEmail: 'jan@example.com',
        body: 'first message',
        bodyFormat: 'text',
        sentAt: '2026-08-13T09:00:00.000Z',
      },
    ],
    isRead: true,
    ...overrides,
  } as MessageDetail
}

// `conversationItems` is memoized on the `detail` identity and its effect
// resets expansion state on every change, so each render must be handed the
// SAME object — building it inside the render callback loops forever.
function renderConversation(detail: MessageDetail) {
  return renderHook(() => useMessageDetailsConversation({ detail, t }))
}

describe('useMessageDetailsConversation', () => {
  it('labels a collapsed thread row with the external identity instead of the system user id', () => {
    // Collapsed rows render through MessageListComponent, which prints
    // `message.senderName` verbatim. Before this chain went through
    // getMessageParticipantLabel every non-expanded row in an ingested email
    // thread showed the communication_channels sentinel uuid.
    const { result } = renderConversation(buildIngestedDetail())

    const collapsed = result.current.conversationItems.find((item) => item.id === 'message-1')
    expect(collapsed).toBeDefined()

    const listItem = result.current.buildConversationListItemMessage(collapsed!)
    expect(listItem.senderName).toBe('Jan Kowalski')
    expect(listItem.senderName).not.toBe(SYSTEM_USER_ID)
  })

  it('carries the external identity onto every conversation item it builds', () => {
    const { result } = renderConversation(buildIngestedDetail())

    expect(result.current.conversationItems).toHaveLength(2)
    for (const item of result.current.conversationItems) {
      expect(item.externalName).toBe('Jan Kowalski')
      expect(item.externalEmail).toBe('jan@example.com')
    }
  })

  it('still prefers a real platform sender over the external counterparty', () => {
    const { result } = renderConversation(buildIngestedDetail({
      thread: [
        {
          id: 'message-1',
          senderUserId: 'user-1',
          senderName: 'Agent Smith',
          senderEmail: 'agent@example.com',
          externalName: 'Jan Kowalski',
          externalEmail: 'jan@example.com',
          body: 'outbound reply',
          bodyFormat: 'text',
          sentAt: '2026-08-13T09:00:00.000Z',
        },
      ],
    }))

    const outbound = result.current.conversationItems.find((item) => item.id === 'message-1')
    expect(result.current.buildConversationListItemMessage(outbound!).senderName).toBe('Agent Smith')
  })

  it('attributes an assigned inbound conversation to the external sender, not the assigned agent', () => {
    // Once an operator assigns the conversation, ingest composes every further
    // inbound message under the agent's user id, so the row resolves a real
    // platform name. `sourceEntityType` is what tells the label chain the
    // message came from outside and the agent is not its author.
    const { result } = renderConversation(buildIngestedDetail({
      sourceEntityType: 'communication_channels.external_conversation',
      thread: [
        {
          id: 'message-1',
          senderUserId: 'agent-1',
          senderName: 'Anna Nowak',
          senderEmail: 'anna@support.example.com',
          externalName: 'Jan Kowalski',
          externalEmail: 'jan@example.com',
          sourceEntityType: 'communication_channels.external_conversation',
          body: 'first message',
          bodyFormat: 'text',
          sentAt: '2026-08-13T09:00:00.000Z',
        },
      ],
    }))

    const inbound = result.current.conversationItems.find((item) => item.id === 'message-1')
    expect(inbound?.sourceEntityType).toBe('communication_channels.external_conversation')
    expect(result.current.buildConversationListItemMessage(inbound!).senderName).toBe('Jan Kowalski')
  })

  it('falls back to the sender id only when no identity at all is available', () => {
    const { result } = renderConversation(buildIngestedDetail({
      thread: [
        {
          id: 'message-1',
          senderUserId: 'user-9',
          senderName: null,
          senderEmail: null,
          externalName: null,
          externalEmail: null,
          body: 'anonymous',
          bodyFormat: 'text',
          sentAt: '2026-08-13T09:00:00.000Z',
        },
      ],
    }))

    const item = result.current.conversationItems.find((entry) => entry.id === 'message-1')
    expect(result.current.buildConversationListItemMessage(item!).senderName).toBe('user-9')
  })
})
