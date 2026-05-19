/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { AiAssistantShellIntegration } from '@/components/AiAssistantShellIntegration'

const loadError = new Error('chunk load failed')

jest.mock('@open-mercato/ai-assistant/frontend', () => {
  throw loadError
})

describe('AiAssistantShellIntegration (import failure)', () => {
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('renders children via a pass-through fallback and logs the failure', async () => {
    render(
      <AiAssistantShellIntegration tenantId="tenant-1" organizationId="org-1">
        <div>AI chat trigger</div>
      </AiAssistantShellIntegration>,
    )

    await waitFor(() => {
      expect(screen.getByText('AI chat trigger')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('ai-assistant-provider')).not.toBeInTheDocument()
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to load AI assistant integration',
      loadError,
    )
  })
})
