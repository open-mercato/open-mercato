/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockApiCall = jest.fn()
const mockReplace = jest.fn()
let mockSearch = ''

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, refresh: jest.fn(), back: jest.fn() }),
  usePathname: () => '/backend/insights/why',
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => {
    const dictionary = jest.requireActual('../../i18n/en.json') as Record<string, string>
    return { translate: (key: string, fallback?: string) => dictionary[key] ?? fallback ?? key }
  },
}))

import { WhyPageClient } from '../WhyPage.client'
import InsightsWhyPage from '../../backend/insights/why/page'
import { resetExplainDescriptorsCache } from '../../lib/client/useExplainDescriptors'
import { DEAL_ID, DICT, apiOk, dealDescriptor, fieldResponse, overviewResponse } from './fixtures'

function respond(responses: Record<string, unknown>) {
  mockApiCall.mockImplementation((input: unknown) => {
    const url = new URL(String(input), 'http://localhost')
    return Promise.resolve(apiOk(responses[url.searchParams.get('field') ? `${url.pathname}#field` : url.pathname]))
  })
}

describe('WhyPageClient', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockReplace.mockReset()
    resetExplainDescriptorsCache()
  })

  it('asks for a record when the query is incomplete', () => {
    mockSearch = 'resourceKind=customers.deal'
    renderWithProviders(<WhyPageClient />, { dict: DICT })
    expect(screen.getByText('Choose a record to explain')).toBeInTheDocument()
    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('renders the route-level empty state from the server page when the query is incomplete', async () => {
    mockSearch = ''
    const element = await InsightsWhyPage()
    renderWithProviders(element, { dict: DICT })
    expect(await screen.findByText('Choose a record to explain')).toBeInTheDocument()
    expect(screen.getByText('Open this page from the "Why?" action of a record.')).toBeInTheDocument()
    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('explains the field from the query and selects fields through the URL', async () => {
    mockSearch = `resourceKind=customers.deal&resourceId=${DEAL_ID}&field=status`
    respond({
      '/api/insights/explain/descriptors': { resources: [dealDescriptor()] },
      '/api/insights/explain#field': fieldResponse(),
      '/api/insights/explain': overviewResponse(),
    })
    renderWithProviders(<WhyPageClient />, { dict: DICT })
    expect(await screen.findByTestId('insights-why-chain')).toBeInTheDocument()
    expect(await screen.findByText('How this Deal got its current values, based on recorded history.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All fields' }))
    expect(mockReplace).toHaveBeenCalledWith(`/backend/insights/why?resourceKind=customers.deal&resourceId=${DEAL_ID}`)
  })
})
