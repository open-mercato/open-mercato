/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render } from '@testing-library/react'
import type { MessageComposerProps } from '@open-mercato/ui/backend/messages/message-composer.types'
import { ComposeMessagePageClient } from '../ComposeMessagePageClient'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockComposer = jest.fn((_props: MessageComposerProps) => null)

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }) }))
jest.mock('@open-mercato/ui/backend/messages', () => ({
  MessageComposer: (props: MessageComposerProps) => mockComposer(props),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: async () => ({ ok: true, result: { items: [] } }) }))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({ InjectionSpot: () => null }))

it('opens the saved message on unconfirmed delivery and sends confirmed compositions to the inbox', async () => {
  await act(async () => { render(<ComposeMessagePageClient />) })
  const { onSuccess } = mockComposer.mock.calls[0][0]
  onSuccess?.({ id: 'message-1', deliveryEnqueueStatus: 'unconfirmed' })
  expect(mockReplace).toHaveBeenCalledWith('/backend/messages/message-1')
  expect(mockPush).not.toHaveBeenCalled()

  onSuccess?.({ id: 'message-2' })
  expect(mockPush).toHaveBeenCalledWith('/backend/messages')
})
