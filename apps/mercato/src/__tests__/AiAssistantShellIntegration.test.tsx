/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { AiAssistantShellIntegration } from '@/components/AiAssistantShellIntegration'

jest.mock('@open-mercato/ai-assistant/frontend', () => ({
  AiAssistantIntegration: ({
    children,
  }: {
    tenantId: string | null
    organizationId: string | null
    children: React.ReactNode
  }) => <div data-testid="ai-assistant-provider">{children}</div>,
}))

describe('AiAssistantShellIntegration', () => {
  it('does not render children until the integration provider loads', async () => {
    render(
      <AiAssistantShellIntegration tenantId="tenant-1" organizationId="org-1">
        <div>AI chat trigger</div>
      </AiAssistantShellIntegration>,
    )

    expect(screen.queryByText('AI chat trigger')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('ai-assistant-provider')).toBeInTheDocument()
      expect(screen.getByText('AI chat trigger')).toBeInTheDocument()
    })
  })
})
