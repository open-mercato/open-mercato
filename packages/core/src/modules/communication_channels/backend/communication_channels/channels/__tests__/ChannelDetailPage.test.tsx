/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import ChannelDetailPage from '../[id]/page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: any) => <div>{children}</div>,
  PageBody: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: any) => <div data-testid="loading">{label}</div>,
  ErrorMessage: ({ label }: any) => <div data-testid="error">{label}</div>,
  RecordNotFoundState: ({ label }: any) => <div data-testid="not-found">{label}</div>,
}))

jest.mock('@open-mercato/ui/primitives/tag', () => ({
  Tag: ({ children }: any) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const channel = {
  id: 'chan-1',
  providerKey: 'slack',
  channelType: 'chat',
  displayName: 'Support Slack',
  externalIdentifier: 'C123',
  capabilities: null,
  isActive: true,
}

const health = {
  channelId: 'chan-1',
  providerKey: 'slack',
  channelType: 'chat',
  windowHours: 24,
  totalsLast24h: 0,
  counts: {},
  recentFailures: [],
}

describe('ChannelDetailPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(apiCall as jest.Mock).mockImplementation((url: string) =>
      Promise.resolve({ ok: true, result: url.endsWith('/health') ? health : channel }),
    )
  })

  // Regression guard for #5600: backend module pages render inside the
  // `/backend/[...slug]` catch-all, which passes the matched route params as a
  // prop. A page that read the id from `useParams()` got `undefined` and never
  // issued this request.
  it('loads the channel using the id from the params prop', async () => {
    render(<ChannelDetailPage params={{ id: 'chan-1' }} />)

    await waitFor(() => expect(apiCall).toHaveBeenCalled())
    const requestedUrls = (apiCall as jest.Mock).mock.calls.map((call) => call[0])
    expect(requestedUrls).toContain('/api/communication_channels/channels/chan-1')
    expect(requestedUrls).toContain('/api/communication_channels/channels/chan-1/health')
    expect(await screen.findByText('Support Slack')).toBeTruthy()
  })

  it('leaves the loading state with an error when no id is supplied', async () => {
    render(<ChannelDetailPage />)

    await waitFor(() => expect(screen.getByTestId('error')).toBeTruthy())
    expect(screen.queryByTestId('loading')).toBeNull()
    expect(apiCall).not.toHaveBeenCalled()
  })
})
