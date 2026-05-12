/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '../../backend/utils/apiCall'
import { AiAssistantLauncher, AI_ASSISTANT_LAUNCHER_OPEN_EVENT } from '../AiAssistantLauncher'

jest.mock('../../backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as unknown as jest.Mock

describe('<AiAssistantLauncher>', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockImplementation(async (url: string) => {
      if (url === '/api/ai_assistant/health') {
        return { ok: true, result: { healthy: true } }
      }
      if (url === '/api/ai_assistant/ai/agents') {
        return {
          ok: true,
          result: {
            aiConfigured: true,
            agents: [
              {
                id: 'catalog.catalog_assistant',
                label: 'Catalog Assistant',
                description: 'Explore catalog data',
                mutationPolicy: 'read-only',
              },
            ],
          },
        }
      }
      throw new Error(`Unexpected apiCall: ${url}`)
    })
  })

  it('opens the assistants picker when the global launcher event is dispatched', async () => {
    renderWithProviders(<AiAssistantLauncher />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Open AI assistant' }).length).toBeGreaterThan(0)
    })

    act(() => {
      window.dispatchEvent(new CustomEvent(AI_ASSISTANT_LAUNCHER_OPEN_EVENT))
    })

    expect(await screen.findByRole('dialog', { name: 'AI assistants' })).toBeInTheDocument()
    expect(screen.getByText('Catalog Assistant')).toBeInTheDocument()
  })
})
