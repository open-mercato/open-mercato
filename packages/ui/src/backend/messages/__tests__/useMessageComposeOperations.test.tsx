/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react'
import { useComposeSendOperation } from '../useMessageComposeOperations'
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
    recipientIds: ['user-1'],
    subject: 'Subject',
    body: 'Body',
    bodyFormat: 'text' as const,
    sendViaEmail: false,
    senderChannelId: '',
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

it('pairs selected mailbox attachments with their compose upload record', () => {
  const { result } = renderHook(() => useComposeSendOperation(buildParams({
    visibility: 'public',
    externalEmail: 'user@example.com',
    senderChannelId: 'mailbox-1',
    attachmentRecordId: 'messages-composer:session-1',
  })))

  expect(result.current.buildRequest({ attachmentIds: ['file-1'] }).payload).toMatchObject({
    senderChannelId: 'mailbox-1',
    attachmentRecordId: 'messages-composer:session-1',
    attachmentIds: ['file-1'],
  })
})
