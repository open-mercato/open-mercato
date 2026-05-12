/**
 * @jest-environment jsdom
 *
 * TC-AI-UI-003: `<AiChat>` UI-part registry integration.
 *
 * Integration-level contract check for Step 4.3 (Phase 2 WS-A). Asserts that a
 * host page rendering `<AiChat>` with a scoped registry resolves a registered
 * custom component over the default Phase 3 placeholder — the same end-to-end
 * code path that Phase 3 approval cards will exercise when Step 5.10 lands.
 *
 * Jest + React Testing Library was chosen over Playwright because
 * `packages/ui` is a pure component package with no runnable Next.js route.
 * The companion browser smoke for this change exercises the code path through
 * a dev-only probe page under `/backend/config/ai-assistant/_dev-aichat-probe`
 * (see `step-4.3-checks.md`). When Step 4.4 lands the real playground route,
 * follow-up Playwright specs will move under
 * `packages/ai-assistant/src/modules/ai_assistant/__integration__/`.
 */

// Polyfill what jsdom lacks before any consumer module pulls in streams.
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
if (
  typeof (globalThis as unknown as { ReadableStream?: unknown }).ReadableStream ===
  'undefined'
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).ReadableStream = nodeStreamWeb.ReadableStream
}

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-transport', () => ({
  createAiAgentTransport: jest.fn(() => ({
    sendMessages: jest.fn(),
    reconnectToStream: jest.fn(),
  })),
}))

jest.mock('@open-mercato/ui/backend/utils/api', () => ({
  apiFetch: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({
    ok: true,
    status: 200,
    result: {
      allowRuntimeModelOverride: false,
      defaultProviderId: 'openai',
      defaultModelId: 'gpt-5-mini',
      providers: [],
    },
  })),
}))

import {
  AiChat,
  createAiUiPartRegistry,
  defaultAiUiPartRegistry,
  resetAiUiPartRegistryForTests,
} from '@open-mercato/ui/ai'

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

describe('TC-AI-UI-003: <AiChat> UI-part registry integration', () => {
  beforeEach(() => {
    resetAiUiPartRegistryForTests()
  })

  afterAll(() => {
    resetAiUiPartRegistryForTests()
  })

  it('resolves a registered Phase 3 card over the default placeholder', () => {
    function FakeApprovalCard({
      componentId,
      payload,
    }: {
      componentId: string
      payload?: unknown
      pendingActionId?: string
    }) {
      const payloadRecord = (payload as Record<string, unknown>) ?? {}
      return (
        <div data-testid="approval-card">
          <span>Approval:{componentId}</span>
          <span data-testid="approval-card-label">
            {String(payloadRecord.label ?? '')}
          </span>
        </div>
      )
    }

    const scoped = createAiUiPartRegistry()
    scoped.register('mutation-preview-card', FakeApprovalCard)

    renderWithProviders(
      <AiChat
        agent="customers.account_assistant"
        registry={scoped}
        uiParts={[
          {
            componentId: 'mutation-preview-card',
            payload: { label: 'Update customer name' },
            pendingActionId: 'act_123',
          },
        ]}
      />,
      { dict },
    )

    const card = screen.getByTestId('approval-card')
    expect(card).toHaveTextContent('Approval:mutation-preview-card')
    expect(screen.getByTestId('approval-card-label')).toHaveTextContent(
      'Update customer name',
    )
    expect(
      document.querySelector(
        '[data-ai-ui-part-pending-phase3="mutation-preview-card"]',
      ),
    ).toBeNull()
  })

  it('shows the Phase 3 placeholder when nothing is registered for a reserved id on a scoped registry', () => {
    // Step 5.10 flipped the DEFAULT registry to live approval cards; scoped
    // registries still seed placeholders by default so the pending-chip path
    // is covered here with an explicit scoped registry.
    const scoped = createAiUiPartRegistry()
    renderWithProviders(
      <AiChat
        agent="customers.account_assistant"
        registry={scoped}
        uiParts={[{ componentId: 'confirmation-card' }]}
      />,
      { dict },
    )

    const placeholder = document.querySelector(
      '[data-ai-ui-part-pending-phase3="confirmation-card"]',
    )
    expect(placeholder).not.toBeNull()
    expect(placeholder?.textContent).toContain('Mutation approval card pending')
    expect(placeholder?.textContent).toContain('confirmation-card')
  })

  it('keeps two <AiChat> instances isolated when each has its own scoped registry', () => {
    function Card({ componentId }: { componentId: string }) {
      return <div data-testid={`card:${componentId}`}>{componentId}</div>
    }
    function OtherCard({ componentId }: { componentId: string }) {
      return (
        <div data-testid={`other-card:${componentId}`}>other:{componentId}</div>
      )
    }

    const a = createAiUiPartRegistry()
    a.register('field-diff-card', Card)
    const b = createAiUiPartRegistry()
    b.register('field-diff-card', OtherCard)

    renderWithProviders(
      <div>
        <AiChat
          agent="customers.account_assistant"
          registry={a}
          uiParts={[{ componentId: 'field-diff-card' }]}
        />
        <AiChat
          agent="customers.account_assistant"
          registry={b}
          uiParts={[{ componentId: 'field-diff-card' }]}
        />
      </div>,
      { dict },
    )

    expect(screen.getByTestId('card:field-diff-card')).toBeInTheDocument()
    expect(screen.getByTestId('other-card:field-diff-card')).toBeInTheDocument()
    // Scoped registries must not write through to the default registry.
    expect(defaultAiUiPartRegistry.resolve('field-diff-card')).not.toBe(Card)
    expect(defaultAiUiPartRegistry.resolve('field-diff-card')).not.toBe(OtherCard)
  })
})
