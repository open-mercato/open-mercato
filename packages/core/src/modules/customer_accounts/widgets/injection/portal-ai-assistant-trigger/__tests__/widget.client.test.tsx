/**
 * @jest-environment jsdom
 *
 * Step 4.10 — Portal AiChat injection widget unit tests.
 *
 * Trigger-level coverage only; the Playwright integration spec
 * `TC-AI-INJECT-010-portal-inject.spec.ts` covers the sheet + chat flow.
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import PortalAiAssistantTriggerWidget from '../widget.client'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback || _key,
}))

jest.mock('@open-mercato/ui/ai/AiChat', () => ({
  AiChat: () => <div data-testid="mock-portal-ai-chat" />,
}))

jest.mock('@open-mercato/shared/security/features', () => ({
  hasFeature: (features: string[], required: string) => features.includes(required),
}))

describe('customer_accounts PortalAiAssistantTriggerWidget', () => {
  it('renders the portal trigger button when the caller is portal admin', () => {
    render(<PortalAiAssistantTriggerWidget context={{ isPortalAdmin: true }} />)
    const trigger = screen.getByRole('button', { name: /open portal ai assistant/i })
    expect(trigger).toBeTruthy()
  })

  it('hides the trigger when the caller lacks the required feature', () => {
    const { container } = render(
      <PortalAiAssistantTriggerWidget
        context={{ isPortalAdmin: false, resolvedFeatures: ['some.other.feature'] }}
      />,
    )
    expect(container.textContent?.trim()).toBe('')
  })
})
