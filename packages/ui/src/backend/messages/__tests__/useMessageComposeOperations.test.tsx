/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react'
import {
  buildReplyAllExternalEmails,
  useComposeDraftOperation,
  useComposeSendOperation,
  useReplySubmitOperation,
  useSendDraftOperation,
  useUpdateDraftOperation,
} from '../useMessageComposeOperations'
import type { MessageTypeItem } from '../message-composer.types'

const messageType: MessageTypeItem = {
  type: 'note',
  module: 'messages',
  labelKey: 'messages.types.note',
  icon: 'message',
  allowReply: true,
  allowForward: true,
}

const t = (_key: string, fallback: string) => fallback

function buildParams(overrides: Partial<Parameters<typeof useComposeSendOperation>[0]> = {}) {
  return {
    t,
    messageType: 'note',
    createableMessageTypes: [messageType],
    priority: 'normal' as const,
    visibility: 'internal' as const,
    externalEmail: '',
    externalEmails: [] as string[],
    sendSeparately: false,
    recipientIds: ['user-1'],
    subject: 'Subject',
    body: 'Body',
    bodyFormat: 'text' as const,
    sendViaEmail: false,
    contextObject: null,
    defaultValues: undefined,
    contextActionOptions: [],
    normalizedRequiredActionMode: 'none' as const,
    shouldShowContextActions: false,
    contextActionRequired: false,
    contextActionType: '',
    ...overrides,
  }
}

describe('useComposeSendOperation payload sendViaEmail', () => {
  it('preserves an explicit false toggle for a public message', () => {
    const { result } = renderHook(() =>
      useComposeSendOperation(
        buildParams({ visibility: 'public', externalEmail: 'user@example.com', sendViaEmail: false }),
      ),
    )

    const request = result.current.buildRequest({ attachmentIds: [] })
    expect(request.payload.sendViaEmail).toBe(false)
  })

  it('preserves an explicit true toggle for a public message', () => {
    const { result } = renderHook(() =>
      useComposeSendOperation(
        buildParams({ visibility: 'public', externalEmail: 'user@example.com', sendViaEmail: true }),
      ),
    )

    const request = result.current.buildRequest({ attachmentIds: [] })
    expect(request.payload.sendViaEmail).toBe(true)
  })

  it('preserves the toggle for an internal message', () => {
    const { result } = renderHook(() =>
      useComposeSendOperation(buildParams({ visibility: 'internal', sendViaEmail: false })),
    )

    const request = result.current.buildRequest({ attachmentIds: [] })
    expect(request.payload.sendViaEmail).toBe(false)
  })
})

describe('useComposeSendOperation external addresses', () => {
  it('sends every external address and the send-separately flag for a public message', () => {
    const { result } = renderHook(() =>
      useComposeSendOperation(
        buildParams({
          visibility: 'public',
          externalEmail: 'a@example.com',
          externalEmails: ['a@example.com', 'b@example.com'],
          sendSeparately: true,
        }),
      ),
    )

    expect(result.current.validate()).toBeNull()
    const { payload } = result.current.buildRequest({ attachmentIds: [] })
    expect(payload.externalEmails).toEqual(['a@example.com', 'b@example.com'])
    expect(payload.sendSeparately).toBe(true)
    expect(payload).not.toHaveProperty('externalEmail')
  })

  it('rejects a public message without any valid external address', () => {
    const { result } = renderHook(() =>
      useComposeSendOperation(buildParams({ visibility: 'public', externalEmails: [] })),
    )

    expect(result.current.validate()).toBe('Please enter a valid external email.')
  })
})

describe('draft operations external addresses', () => {
  const publicDraft = {
    visibility: 'public' as const,
    externalEmail: 'a@example.com',
    externalEmails: ['a@example.com', 'b@example.com'],
    sendSeparately: true,
    senderChannelId: '',
  }

  it('saves a new draft with every address and the separate flag', () => {
    const { result } = renderHook(() => useComposeDraftOperation(buildParams(publicDraft)))

    const request = result.current.buildRequest({ attachmentIds: [] })
    expect(request).toMatchObject({ endpoint: '/api/messages', method: 'POST' })
    expect(request.payload).toMatchObject({ isDraft: true, externalEmails: ['a@example.com', 'b@example.com'], sendSeparately: true })
    expect(request.payload).not.toHaveProperty('externalEmail')
  })

  it('updates a saved draft with the replacement address set', () => {
    const { result } = renderHook(() => useUpdateDraftOperation({ ...buildParams(publicDraft), messageId: 'draft-1' }))

    const request = result.current.buildRequest({ attachmentIds: [] })
    expect(request).toMatchObject({ endpoint: '/api/messages/draft-1', method: 'PATCH' })
    expect(request.payload).toMatchObject({ externalEmails: ['a@example.com', 'b@example.com'], sendSeparately: true })
    expect(request.payload).not.toHaveProperty('isDraft')
  })

  it('sends a saved draft with every address and validates the whole list', () => {
    const { result } = renderHook(() => useSendDraftOperation({ ...buildParams(publicDraft), messageId: 'draft-1' }))

    expect(result.current.validate()).toBeNull()
    expect(result.current.buildRequest({ attachmentIds: [] }).payload).toMatchObject({
      isDraft: false,
      externalEmails: ['a@example.com', 'b@example.com'],
      sendSeparately: true,
    })

    const invalid = renderHook(() => useSendDraftOperation({
      ...buildParams({ ...publicDraft, externalEmails: ['a@example.com', 'not-an-address'] }),
      messageId: 'draft-1',
    }))
    expect(invalid.result.current.validate()).toBe('Please enter a valid external email.')
  })
})

describe('reply-all external addresses', () => {
  const replyParams = {
    t,
    messageId: 'msg-1',
    body: 'Thanks',
    bodyFormat: 'text' as const,
    recipientIds: [] as string[],
    sendViaEmail: true,
    externalEmails: ['a@example.com', 'c@example.com'],
    sendSeparately: false,
  }

  it('posts the pre-filled addresses only for reply all', () => {
    const replyAll = renderHook(() => useReplySubmitOperation({ ...replyParams, replyAll: true }))
    expect(replyAll.result.current.buildRequest({ attachmentIds: [] }).payload).toMatchObject({
      replyAll: true,
      externalEmails: ['a@example.com', 'c@example.com'],
      sendSeparately: false,
    })

    const single = renderHook(() => useReplySubmitOperation({ ...replyParams, replyAll: false }))
    expect(single.result.current.buildRequest({ attachmentIds: [] }).payload).not.toHaveProperty('externalEmails')
  })

  it('pre-fills from the counterpart and to/cc participants, never bcc, without own mailboxes', () => {
    expect(buildReplyAllExternalEmails(
      {
        externalEmail: 'sender@example.com',
        externalParticipants: [
          { role: 'to', email: 'Me@Company.com' },
          { role: 'to', email: 'colleague@example.com' },
          { role: 'cc', email: 'SENDER@example.com' },
          { role: 'cc', email: 'cc@example.com' },
          { role: 'bcc', email: 'hidden@example.com' },
        ],
      },
      ['me@company.com'],
    )).toEqual(['sender@example.com', 'colleague@example.com', 'cc@example.com'])
  })

  it('returns nothing for a source without external addresses', () => {
    expect(buildReplyAllExternalEmails({ externalEmail: null, externalParticipants: null })).toEqual([])
  })
})

