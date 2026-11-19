/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import en from '../../i18n/en.json'
import { McpExposureSection, McpExposureSectionContent, type McpExposureView } from '../McpExposureSection'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div role="alert">{label}</div>,
}))

const dict = en as Record<string, string>

const VIEW: McpExposureView = {
  mutationMode: 'approval',
  allowlist: ['customers.*'],
  denylist: [],
  agentToolsEnabled: true,
  tools: [
    {
      name: 'customers.account_assistant.run',
      module: 'customers',
      exposed: true,
      hiddenReason: null,
      isMutation: false,
      agentRef: { agentId: 'customers.account_assistant', engine: 'ai-assistant' },
    },
    {
      name: 'catalog.list_products',
      module: 'catalog',
      exposed: false,
      hiddenReason: 'not_allowlisted',
      isMutation: false,
      agentRef: null,
    },
    {
      name: 'customers.update_person',
      module: 'customers',
      exposed: true,
      hiddenReason: null,
      isMutation: true,
      agentRef: null,
    },
  ],
}

describe('McpExposureSectionContent', () => {
  it('renders the exposure config and per-tool status with markers', () => {
    renderWithProviders(<McpExposureSectionContent view={VIEW} />, { dict })

    expect(screen.getByText(dict['ai_assistant.mcp.exposure.mutationMode.approval'])).toBeTruthy()
    expect(screen.getByText('customers.*')).toBeTruthy()
    expect(screen.getByText(dict['ai_assistant.mcp.exposure.listNone'])).toBeTruthy()
    expect(screen.getByText(dict['ai_assistant.mcp.exposure.agentToolsOn'])).toBeTruthy()
    expect(screen.getAllByText(dict['ai_assistant.mcp.exposure.exposed'])).toHaveLength(2)
    expect(screen.getByText(dict['ai_assistant.mcp.exposure.hiddenReason.notAllowlisted'])).toBeTruthy()
    expect(screen.getByText(dict['ai_assistant.mcp.exposure.agentTool'])).toBeTruthy()
    expect(screen.getByText(dict['ai_assistant.mcp.exposure.mutationTool'])).toBeTruthy()
  })

  it('renders the empty state when no tools are available', () => {
    renderWithProviders(<McpExposureSectionContent view={{ ...VIEW, allowlist: null, tools: [] }} />, { dict })
    expect(screen.getByText(dict['ai_assistant.mcp.exposure.allowlistAll'])).toBeTruthy()
    expect(screen.getByText(dict['ai_assistant.mcp.exposure.empty'])).toBeTruthy()
  })
})

describe('McpExposureSection', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('loads the mcp view and shows the exposed count', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: VIEW })
    renderWithProviders(<McpExposureSection />, { dict })

    expect(await screen.findByText('2')).toBeTruthy()
    expect(apiCallMock).toHaveBeenCalledWith('/api/ai_assistant/tools?view=mcp')
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('catalog.list_products')).toBeTruthy()
  })

  it('shows an error message when the request fails', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 500, result: null })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderWithProviders(<McpExposureSection />, { dict, queryClient })
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText(dict['ai_assistant.mcp.exposure.error'])).toBeTruthy()
  })
})
