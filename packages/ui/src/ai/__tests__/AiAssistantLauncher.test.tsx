/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '../../backend/utils/apiCall'
import { AiAssistantLauncher, AI_ASSISTANT_LAUNCHER_OPEN_EVENT } from '../AiAssistantLauncher'
import { useAiAssistantAvailable } from '../useAiAssistantAvailable'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('../../backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../useAiAssistantAvailable', () => ({
  useAiAssistantAvailable: jest.fn(() => true),
}))

const apiCallMock = apiCall as unknown as jest.Mock
const aiAvailableMock = useAiAssistantAvailable as jest.MockedFunction<typeof useAiAssistantAvailable>

describe('<AiAssistantLauncher>', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    aiAvailableMock.mockReset()
    aiAvailableMock.mockReturnValue(true)
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
  }, 60_000)

  it('renders nothing and probes no endpoint when the AI assistant is unavailable', async () => {
    aiAvailableMock.mockReturnValue(false)

    const { container } = renderWithProviders(<AiAssistantLauncher />)

    expect(container.firstChild).toBeNull()

    // Give the effects a chance to run before asserting they never did.
    await act(async () => {
      await Promise.resolve()
    })

    expect(apiCallMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Open AI assistant' })).toBeNull()
  })

  it('ignores the global launcher shortcut event when the AI assistant is unavailable', async () => {
    aiAvailableMock.mockReturnValue(false)

    renderWithProviders(<AiAssistantLauncher />)

    act(() => {
      window.dispatchEvent(new CustomEvent(AI_ASSISTANT_LAUNCHER_OPEN_EVENT))
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByRole('dialog', { name: 'AI assistants' })).toBeNull()
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  // The gate is fail-closed until the backend chrome payload arrives, so on an
  // enabled install the launcher always mounts unavailable first and only then
  // flips. The probes must fire on that transition, and only once.
  it('probes exactly once when the gate opens after mount', async () => {
    aiAvailableMock.mockReturnValue(false)

    const { rerender } = renderWithProviders(<AiAssistantLauncher />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(apiCallMock).not.toHaveBeenCalled()

    aiAvailableMock.mockReturnValue(true)
    rerender(<AiAssistantLauncher />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Open AI assistant' }).length).toBeGreaterThan(0)
    })

    const agentsCalls = apiCallMock.mock.calls.filter(
      ([url]) => url === '/api/ai_assistant/ai/agents',
    )
    expect(agentsCalls).toHaveLength(1)
  }, 60_000)
})
