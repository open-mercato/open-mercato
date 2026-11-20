/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MessageDetailComposerDialogs } from '../composer-dialogs'
import type { MessageDetail } from '../../types'

const composerProps: Array<Record<string, unknown>> = []
const senderOptions = [{ id: 'mailbox-1', label: 'Mailbox 1' }]
const scheduling = { available: true, maxDays: 30 }

jest.mock('@open-mercato/ui/backend/messages', () => ({
  MessageComposer: (props: Record<string, unknown>) => {
    composerProps.push(props)
    return null
  },
  useComposeScheduling: () => scheduling,
}))

jest.mock('@open-mercato/core/modules/messages/components/useComposeSenderOptions', () => ({
  useComposeSenderOptions: () => senderOptions,
}))

const detail = {
  id: 'message-1',
  type: 'default',
  isDraft: true,
  canEditDraft: true,
  recipients: [],
  subject: 'Hello',
  body: 'Body',
  bodyFormat: 'text',
  priority: 'normal',
  senderChannelId: 'mailbox-1',
  scheduledAt: '2030-01-01T10:00:00.000Z',
} as unknown as MessageDetail

function setup() {
  composerProps.length = 0
  const queryClient = new QueryClient()
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries')
  const setEditOpen = jest.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <MessageDetailComposerDialogs
        id="message-1"
        detail={detail}
        attachments={[]}
        editOpen
        setEditOpen={setEditOpen}
      />
    </QueryClientProvider>,
  )
  return { props: () => composerProps[composerProps.length - 1], invalidate, setEditOpen }
}

describe('MessageDetailComposerDialogs', () => {
  it('passes sender options, scheduling and the stored sender and schedule', () => {
    const { props } = setup()
    expect(props().senderOptions).toBe(senderOptions)
    expect(props().scheduling).toBe(scheduling)
    expect(props().defaultValues).toMatchObject({
      senderChannelId: 'mailbox-1',
      scheduledAt: '2030-01-01T10:00:00.000Z',
    })
  })

  it('invalidates the detail and attachments queries on success', () => {
    const { props, invalidate, setEditOpen } = setup()
    act(() => (props().onSuccess as () => void)())
    expect(setEditOpen).toHaveBeenCalledWith(false)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages', 'detail', 'message-1'] })
  })

  it('invalidates when the dialog is closed without saving', () => {
    const { props, invalidate } = setup()
    act(() => (props().onOpenChange as (next: boolean) => void)(false))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages', 'detail', 'message-1'] })
  })
})
