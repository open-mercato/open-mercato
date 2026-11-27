/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { useMessageCompose } from '../useMessageCompose'
import { createMessageComposeFormGroups } from '../message-compose-form-groups'
import { apiCall } from '../../utils/apiCall'
import type { MessageSenderOption } from '../message-composer.types'

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((_headers: unknown, run: () => unknown) => run()),
}))

jest.mock('../../FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../../detail/AttachmentsSection', () => ({
  AttachmentsSection: () => <div data-testid="attachments-section" />,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/messages',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))

const senderOptions: MessageSenderOption[] = [
  { id: 'mailbox-files', label: 'Gmail', supportsAttachments: true },
  { id: 'mailbox-plain', label: 'Plain mailbox', supportsAttachments: false },
]

function ComposeBody({ senderChannelId }: { senderChannelId: string }) {
  const compose = useMessageCompose({ variant: 'compose', inline: true, senderOptions })
  const { setSenderChannelId, setVisibility } = compose
  React.useEffect(() => {
    setVisibility('public')
    setSenderChannelId(senderChannelId)
  }, [senderChannelId, setSenderChannelId, setVisibility])
  const [group] = createMessageComposeFormGroups(compose)
  const renderBody = group.component as () => React.ReactNode
  return <>{renderBody()}</>
}

function renderComposeBody(senderChannelId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {/* @ts-expect-error shared provider accepts a loose dict shape */}
      <I18nProvider locale="en" dict={{}}>
        <ComposeBody senderChannelId={senderChannelId} />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe('composer attachments for the selected sender', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, status: 200, result: { items: [] } })
  })

  it('hides the attachments and explains why when the mailbox cannot send them', async () => {
    renderComposeBody('mailbox-plain')

    expect(await screen.findByText(/The selected mailbox cannot send attachments/)).toBeTruthy()
    expect(screen.queryByTestId('attachments-section')).toBeNull()
  })

  it('shows the attachments for a mailbox that can send them', async () => {
    renderComposeBody('mailbox-files')

    expect(await screen.findByTestId('attachments-section')).toBeTruthy()
    expect(screen.queryByText(/The selected mailbox cannot send attachments/)).toBeNull()
  })

  it('shows the attachments for the platform sender', async () => {
    renderComposeBody('')

    expect(await screen.findByTestId('attachments-section')).toBeTruthy()
  })
})
