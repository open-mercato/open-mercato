/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AiChatSessionsProvider } from '../AiChatSessions'
import { AiDockProvider, useAiDock, type AiDockedAssistant } from '../AiDock'

jest.mock('../AiChat', () => {
  const ReactModule = require('react') as typeof import('react')
  return {
    AiChat: ({
      agent,
      defaultCompactFooter,
      onConversationNotFound,
    }: {
      agent: string
      defaultCompactFooter?: boolean
      onConversationNotFound?: () => void
    }) =>
      ReactModule.createElement('div', {
        'data-testid': 'ai-chat',
        'data-agent': agent,
        'data-default-compact-footer': defaultCompactFooter ? 'true' : 'false',
        'data-has-conversation-not-found-handler': typeof onConversationNotFound === 'function' ? 'true' : 'false',
        onClick: () => onConversationNotFound?.(),
      }),
  }
})

const STORAGE_KEY = 'om-ai-dock-v1'

const assistant: AiDockedAssistant = {
  agent: 'customers.account_assistant',
  label: 'CRM Assistant',
  description: 'Customers',
  pageContext: { view: 'customers.people.list' },
  placeholder: 'Ask about customers...',
  welcomeTitle: 'CRM Assistant',
  welcomeDescription: 'Ask me anything about customers.',
  suggestions: [
    {
      label: 'Summarize selected',
      prompt: 'Summarize the selected customers.',
      icon: <span>Icon</span>,
    },
  ],
  contextItems: [{ label: '2 contacts selected' }],
}

function readStored(): Record<string, unknown> {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) as Record<string, unknown> : {}
}

function readStoredAssistant(): Record<string, unknown> | null {
  const value = readStored().assistant
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function DockButton() {
  const dock = useAiDock()
  return (
    <button type="button" onClick={() => dock.dock(assistant)}>
      Dock assistant
    </button>
  )
}

function Harness({ withButton = true }: { withButton?: boolean }) {
  return (
    <AiChatSessionsProvider>
      <AiDockProvider>
        {withButton ? <DockButton /> : null}
        <main>Content</main>
      </AiDockProvider>
    </AiChatSessionsProvider>
  )
}

describe('<AiDockProvider>', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('persists the docked assistant and restores it after remount', async () => {
    const { unmount } = renderWithProviders(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Dock assistant' }))

    expect(document.querySelector('[data-ai-dock-agent="customers.account_assistant"]')).toBeInTheDocument()
    await waitFor(() => {
      expect(readStoredAssistant()?.agent).toBe('customers.account_assistant')
    })

    const storedAssistant = readStoredAssistant()
    expect(storedAssistant?.label).toBe('CRM Assistant')
    expect(storedAssistant?.pageContext).toEqual({ view: 'customers.people.list' })
    expect(storedAssistant?.suggestions).toEqual([
      { label: 'Summarize selected', prompt: 'Summarize the selected customers.' },
    ])

    unmount()
    renderWithProviders(<Harness withButton={false} />)

    await waitFor(() => {
      expect(document.querySelector('[data-ai-dock-agent="customers.account_assistant"]')).toBeInTheDocument()
    })
  })

  it('clears the persisted assistant when the dock is closed', async () => {
    renderWithProviders(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Dock assistant' }))
    await waitFor(() => {
      expect(readStoredAssistant()?.agent).toBe('customers.account_assistant')
    })

    const closeButton = document.querySelector('[data-ai-dock-close=""]')
    expect(closeButton).toBeInstanceOf(HTMLElement)
    fireEvent.click(closeButton as HTMLElement)

    await waitFor(() => {
      expect(readStoredAssistant()).toBeNull()
    })
    expect(document.querySelector('[data-ai-dock-panel=""]')).not.toBeInTheDocument()
  })

  it('starts the chat footer compact inside the dock', async () => {
    renderWithProviders(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Dock assistant' }))

    await waitFor(() => {
      expect(screen.getByTestId('ai-chat')).toHaveAttribute('data-default-compact-footer', 'true')
    })
  })

  it('wires onConversationNotFound so a stale session closes (no perpetual blank chat)', async () => {
    renderWithProviders(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Dock assistant' }))

    const chat = await waitFor(() => screen.getByTestId('ai-chat'))
    expect(chat).toHaveAttribute('data-has-conversation-not-found-handler', 'true')

    // Fire the not-found callback via the mocked AiChat's onClick.
    fireEvent.click(chat)

    // After closeSession, the active session disappears; DockedChatBody
    // schedules ensureSession in an effect, so for one tick the AiChat
    // surface should be torn down before the new session mounts.
    await waitFor(() => {
      const next = screen.queryByTestId('ai-chat')
      if (next === chat) throw new Error('stale chat surface should have unmounted')
    })
  })
})
