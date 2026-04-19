/**
 * @jest-environment jsdom
 *
 * Step 4.10 — Backend AiChat injection widget unit tests.
 *
 * The widget itself is a trigger button that opens a Dialog embedding
 * `<AiChat>`. Unit-test only the trigger + selection-pill computation;
 * the sheet-open + chat behavior is covered by the Playwright
 * integration spec `TC-AI-INJECT-009-backend-inject.spec.ts`.
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import AiAssistantTriggerWidget from '../widget.client'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) => {
    if (!fallback) return _key
    if (!vars) return fallback
    return fallback.replace(/\{(\w+)\}/g, (_m, name) =>
      name in vars ? String((vars as Record<string, unknown>)[name]) : `{${name}}`,
    )
  },
}))

jest.mock('@open-mercato/ui/ai/AiChat', () => ({
  AiChat: () => <div data-testid="mock-ai-chat" />,
}))

describe('customers AiAssistantTriggerWidget', () => {
  it('renders the trigger button with the spec §10.1 test hook', () => {
    render(<AiAssistantTriggerWidget context={{ selectedCount: 0, totalMatching: 0 }} />)
    const trigger = screen.getByRole('button', { name: /open ai assistant for people/i })
    expect(trigger).toBeTruthy()
    expect(trigger.getAttribute('data-ai-customers-inject-trigger')).toBe('')
  })

  it('degrades gracefully when host context is absent', () => {
    render(<AiAssistantTriggerWidget />)
    expect(
      screen.getByRole('button', { name: /open ai assistant for people/i }),
    ).toBeTruthy()
  })
})
