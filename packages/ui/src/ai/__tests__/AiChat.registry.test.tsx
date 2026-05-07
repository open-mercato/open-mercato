/**
 * @jest-environment jsdom
 */

// Polyfill what jsdom lacks before AiChat imports pull in anything stream-y.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeUtil = require('node:util') as typeof import('node:util')
if (typeof globalThis.TextEncoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).TextEncoder = nodeUtil.TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).TextDecoder =
    nodeUtil.TextDecoder as unknown as typeof TextDecoder
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeStreamWeb = require('node:stream/web') as typeof import('node:stream/web')
if (typeof (globalThis as unknown as { ReadableStream?: unknown }).ReadableStream === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).ReadableStream = nodeStreamWeb.ReadableStream
}

import * as React from 'react'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-transport', () => ({
  createAiAgentTransport: jest.fn(() => ({
    sendMessages: jest.fn(),
    reconnectToStream: jest.fn(),
  })),
}))

jest.mock('../../backend/utils/api', () => ({
  apiFetch: jest.fn(),
}))

import { AiChat } from '../AiChat'
import {
  createAiUiPartRegistry,
  defaultAiUiPartRegistry,
  resetAiUiPartRegistryForTests,
} from '../ui-part-registry'

const dict = {
  'ai_assistant.chat.assistantRoleLabel': 'Assistant',
  'ai_assistant.chat.cancel': 'Cancel streaming response',
  'ai_assistant.chat.composerLabel': 'Message composer',
  'ai_assistant.chat.composerPlaceholder': 'Message the AI agent...',
  'ai_assistant.chat.debugPanelTitle': 'Debug panel',
  'ai_assistant.chat.emptyTranscript':
    'No messages yet. Ask the agent anything to get started.',
  'ai_assistant.chat.errorTitle': 'Agent dispatch failed',
  'ai_assistant.chat.regionLabel': 'AI chat',
  'ai_assistant.chat.send': 'Send message',
  'ai_assistant.chat.shortcutHint':
    'Press Cmd/Ctrl+Enter to send, Escape to cancel.',
  'ai_assistant.chat.thinking': 'Thinking...',
  'ai_assistant.chat.transcriptLabel': 'Chat transcript',
  'ai_assistant.chat.pending_phase3.body':
    'This interactive card will land in Phase 3 of the unified AI framework.',
  'ai_assistant.chat.pending_phase3.title': 'Mutation approval card pending',
  'ai_assistant.chat.uiPartPending': 'Pending UI part:',
  'ai_assistant.chat.userRoleLabel': 'You',
}

describe('<AiChat> × UI-part registry', () => {
  beforeEach(() => {
    resetAiUiPartRegistryForTests()
  })

  afterAll(() => {
    resetAiUiPartRegistryForTests()
  })

  it('renders the Phase 3 placeholder for a reserved id on a scoped registry without live seeding', () => {
    // Step 5.10 flipped the DEFAULT registry over to live approval cards,
    // so we use a scoped registry (the placeholder default) to exercise the
    // pending-chip renderer path.
    const scoped = createAiUiPartRegistry()
    renderWithProviders(
      <AiChat
        agent="customers.account_assistant"
        registry={scoped}
        uiParts={[{ componentId: 'mutation-preview-card', payload: { foo: 1 } }]}
      />,
      { dict },
    )
    const region = screen.getByRole('region', { name: 'AI chat' })
    const placeholder = region.querySelector(
      '[data-ai-ui-part-pending-phase3="mutation-preview-card"]',
    )
    expect(placeholder).not.toBeNull()
    expect(placeholder?.textContent).toContain('Mutation approval card pending')
  })

  it('renders a registered custom component instead of the placeholder', () => {
    function RealCard({ componentId }: { componentId: string }) {
      return (
        <div data-testid="real-mutation-preview">REAL:{componentId}</div>
      )
    }
    const scoped = createAiUiPartRegistry()
    scoped.register('mutation-preview-card', RealCard)

    renderWithProviders(
      <AiChat
        agent="customers.account_assistant"
        registry={scoped}
        uiParts={[{ componentId: 'mutation-preview-card' }]}
      />,
      { dict },
    )

    expect(screen.getByTestId('real-mutation-preview')).toHaveTextContent(
      'REAL:mutation-preview-card',
    )
    // The placeholder is NOT rendered when a real component is registered.
    expect(
      document.querySelector(
        '[data-ai-ui-part-pending-phase3="mutation-preview-card"]',
      ),
    ).toBeNull()
  })

  it('renders the neutral chip (not the Phase 3 placeholder) for unknown non-reserved ids', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderWithProviders(
        <AiChat
          agent="customers.account_assistant"
          uiParts={[{ componentId: 'not-a-real-id' }]}
        />,
        { dict },
      )

      expect(
        document.querySelector('[data-ai-ui-part-placeholder="not-a-real-id"]'),
      ).not.toBeNull()
      expect(
        document.querySelector(
          '[data-ai-ui-part-pending-phase3="not-a-real-id"]',
        ),
      ).toBeNull()
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('two <AiChat> instances with different registries do not leak registrations', () => {
    function RedCard({ componentId }: { componentId: string }) {
      return <div data-testid={`red-${componentId}`}>RED</div>
    }
    function BlueCard({ componentId }: { componentId: string }) {
      return <div data-testid={`blue-${componentId}`}>BLUE</div>
    }

    const registryA = createAiUiPartRegistry()
    registryA.register('confirmation-card', RedCard)
    const registryB = createAiUiPartRegistry()
    registryB.register('confirmation-card', BlueCard)

    const { container } = renderWithProviders(
      <div>
        <div data-testid="host-a">
          <AiChat
            agent="customers.account_assistant"
            registry={registryA}
            uiParts={[{ componentId: 'confirmation-card' }]}
          />
        </div>
        <div data-testid="host-b">
          <AiChat
            agent="customers.account_assistant"
            registry={registryB}
            uiParts={[{ componentId: 'confirmation-card' }]}
          />
        </div>
      </div>,
      { dict },
    )

    const hostA = within(screen.getByTestId('host-a'))
    const hostB = within(screen.getByTestId('host-b'))
    expect(hostA.getByTestId('red-confirmation-card')).toBeInTheDocument()
    expect(hostB.getByTestId('blue-confirmation-card')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-testid="red-confirmation-card"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-testid="blue-confirmation-card"]')).toHaveLength(1)

    // The scoped registries never wrote through to the default registry.
    expect(defaultAiUiPartRegistry.resolve('confirmation-card')).not.toBe(RedCard)
    expect(defaultAiUiPartRegistry.resolve('confirmation-card')).not.toBe(BlueCard)
  })

  it('falls back to the default registry when no registry prop is provided', () => {
    function GlobalCard() {
      return <div data-testid="global-card">GLOBAL</div>
    }
    defaultAiUiPartRegistry.register('mutation-result-card', GlobalCard)

    renderWithProviders(
      <AiChat
        agent="customers.account_assistant"
        uiParts={[{ componentId: 'mutation-result-card' }]}
      />,
      { dict },
    )

    expect(screen.getByTestId('global-card')).toBeInTheDocument()
  })
})
