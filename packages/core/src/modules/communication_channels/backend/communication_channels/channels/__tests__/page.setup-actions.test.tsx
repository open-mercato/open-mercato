/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import ChannelsListPage from '../page'

let mockGrantedFeatures: string[]

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockGrantedFeatures } }),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ actions, emptyState, isLoading }: {
    actions: React.ReactNode
    emptyState: React.ReactNode
    isLoading: boolean
  }) => <>{actions}{isLoading ? null : emptyState}</>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { items: [] } })),
}))

describe('Shared channel setup actions', () => {
  test.each([
    {
      features: ['integrations.view', 'communication_channels.connect_user_channel'],
      providers: 2,
      mailbox: 2,
    },
    { features: ['integrations.view'], providers: 2, mailbox: 0 },
    { features: ['communication_channels.connect_user_channel'], providers: 0, mailbox: 2 },
    { features: [], providers: 0, mailbox: 0 },
  ])('renders each action according to its own grant for $features', async ({ features, providers, mailbox }) => {
    mockGrantedFeatures = features
    renderWithProviders(<ChannelsListPage />)

    await screen.findByText('No shared channels yet')
    const providerLinks = screen.queryAllByRole('link', { name: 'Configure providers' })
    const mailboxLinks = screen.queryAllByRole('link', { name: 'Connect my mailbox' })
    expect(providerLinks).toHaveLength(providers)
    expect(mailboxLinks).toHaveLength(mailbox)
    for (const link of providerLinks) {
      expect(link).toHaveAttribute('href', '/backend/integrations?category=communication')
    }
    for (const link of mailboxLinks) {
      expect(link).toHaveAttribute('href', '/backend/profile/communication-channels')
    }
  })
})
