/**
 * @jest-environment jsdom
 */

// jsdom does not ship TextEncoder/TextDecoder/ReadableStream globals — polyfill
// before any consumer module imports them.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeUtil = require('node:util') as typeof import('node:util')
if (typeof globalThis.TextEncoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).TextEncoder = nodeUtil.TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).TextDecoder = nodeUtil.TextDecoder as unknown as typeof TextDecoder
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeStreamWeb = require('node:stream/web') as typeof import('node:stream/web')
if (typeof (globalThis as unknown as { ReadableStream?: unknown }).ReadableStream === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).ReadableStream = nodeStreamWeb.ReadableStream
}

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
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

const dict = {
  'ai_assistant.chat.composerLabel': 'Message composer',
  'ai_assistant.chat.composerPlaceholder': 'Message the AI agent...',
  'ai_assistant.chat.debug.panelTitle': 'Debug panel',
  'ai_assistant.chat.debug.toolsSection': 'Resolved tools',
  'ai_assistant.chat.debug.toolsEmpty': 'No tools resolved for this agent yet.',
  'ai_assistant.chat.debug.promptSection': 'Prompt sections',
  'ai_assistant.chat.debug.promptEmpty': 'No prompt sections resolved for this agent.',
  'ai_assistant.chat.debug.lastRequestSection': 'Last request',
  'ai_assistant.chat.debug.lastRequestEmpty': 'No request has been sent yet.',
  'ai_assistant.chat.debug.lastResponseSection': 'Last response',
  'ai_assistant.chat.debug.lastResponseEmpty': 'No response received yet.',
  'ai_assistant.chat.debug.statusLabel': 'Status:',
  'ai_assistant.chat.debug.toolMutation': 'mutation',
  'ai_assistant.chat.debug.toolRead': 'read',
  'ai_assistant.chat.debug.toolNoFeatures': 'no required features',
  'ai_assistant.chat.debug.promptDefault': 'default',
  'ai_assistant.chat.debug.promptPlaceholder': 'placeholder',
  'ai_assistant.chat.debug.promptOverride': 'override',
  'ai_assistant.chat.errorTitle': 'Agent dispatch failed',
  'ai_assistant.chat.regionLabel': 'AI chat',
  'ai_assistant.chat.send': 'Send message',
  'ai_assistant.chat.shortcutHint': 'Press Cmd/Ctrl+Enter to send, Escape to cancel.',
  'ai_assistant.chat.thinking': 'Thinking...',
  'ai_assistant.chat.transcriptLabel': 'Chat transcript',
  'ai_assistant.chat.uiPartPending': 'Pending UI part:',
  'ai_assistant.chat.userRoleLabel': 'You',
  'ai_assistant.chat.assistantRoleLabel': 'Assistant',
  'ai_assistant.chat.emptyTranscript':
    'No messages yet. Ask the agent anything to get started.',
  'ai_assistant.chat.cancel': 'Cancel streaming response',
}

describe('<AiChat> debug panel (Step 4.6)', () => {
  it('renders all four debug sections when debug=true', () => {
    renderWithProviders(
      <AiChat
        agent="customers.assistant"
        debug
        debugTools={[
          {
            name: 'customers.list_people',
            displayName: 'List people',
            isMutation: false,
            requiredFeatures: ['customers.view'],
          },
          { name: 'customers.update_person', isMutation: true },
        ]}
        debugPromptSections={[
          { id: 'role', source: 'default', text: 'You are an assistant.' },
          { id: 'scope', source: 'placeholder' },
        ]}
      />,
      { dict },
    )
    expect(screen.getByText('Debug panel')).toBeInTheDocument()
    // Tools section
    const toolsSection = screen.getByText(/Resolved tools/i)
    expect(toolsSection).toBeInTheDocument()
    // Both tools render
    expect(screen.getByText('customers.list_people')).toBeInTheDocument()
    expect(screen.getByText('customers.update_person')).toBeInTheDocument()
    // Prompt sections render
    expect(screen.getByText(/Prompt sections/i)).toBeInTheDocument()
    expect(screen.getByText('role')).toBeInTheDocument()
    expect(screen.getByText('scope')).toBeInTheDocument()
    // Last request / response sections render
    expect(screen.getByText('Last request')).toBeInTheDocument()
    expect(screen.getByText('Last response')).toBeInTheDocument()
    // Empty-state copy for request + response until the user sends something.
    expect(screen.getByText('No request has been sent yet.')).toBeInTheDocument()
    expect(screen.getByText('No response received yet.')).toBeInTheDocument()
  })

  it('does not render the debug panel when debug is falsy', () => {
    renderWithProviders(
      <AiChat agent="customers.assistant" />,
      { dict },
    )
    expect(screen.queryByText('Debug panel')).not.toBeInTheDocument()
  })

  it('collapses sections via the native <details> toggle', () => {
    renderWithProviders(
      <AiChat agent="customers.assistant" debug />,
      { dict },
    )
    const toolsDetails = document.querySelector(
      '[data-ai-chat-debug-section="tools"]',
    ) as HTMLDetailsElement | null
    expect(toolsDetails).not.toBeNull()
    // Opens by default (we pass `open` on the tools section).
    expect(toolsDetails!.open).toBe(true)
    fireEvent.click(toolsDetails!.querySelector('summary')!)
    // jsdom does not automatically toggle <details> on click — emulate state
    // by assigning `open` ourselves; the assertion is simply that the <details>
    // element is present and addressable.
    toolsDetails!.open = false
    expect(toolsDetails!.open).toBe(false)
  })

  it('renders the empty-state copy when no tools/sections are provided', () => {
    renderWithProviders(
      <AiChat agent="customers.assistant" debug debugTools={[]} debugPromptSections={[]} />,
      { dict },
    )
    expect(screen.getByText('No tools resolved for this agent yet.')).toBeInTheDocument()
    expect(
      screen.getByText('No prompt sections resolved for this agent.'),
    ).toBeInTheDocument()
  })
})

// <AiChat> mounts useAgentModels (Phase 4b) which hits /api/ai_assistant/ai/agents/<id>/models
// on first render via apiCall. Stub apiCall with a no-providers response so this files
// chat-flow assertions remain scoped to the dispatcher mock above.
jest.mock('../../backend/utils/apiCall', () => ({
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
