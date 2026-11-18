/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { registerCoreInjectionTables, registerCoreInjectionWidgets, registerEnabledModuleIds } from '@open-mercato/shared/modules/widgets/injection-loader'

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = MockResizeObserver

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '',
  useSearchParams: () => new URLSearchParams(),
}))

import { AccessLogsTable, type AccessLogItem } from '../AccessLogsTable'
import english from '../../i18n/en.json'

const injected = '<img src=x onerror="window.__pwned=1">'

const mcpItem: AccessLogItem = {
  id: 'log-1',
  resourceKind: 'ai_assistant.mcp_tool_call',
  resourceId: 'customers.list_deals',
  accessType: 'call',
  actorUserId: 'user-1',
  actorUserName: 'employee@acme.com',
  tenantId: 'tenant-1',
  tenantName: 'Acme',
  organizationId: 'org-1',
  organizationName: 'Acme',
  fields: [],
  context: {
    channel: 'mcp',
    mcpServer: 'http',
    apiKeyId: 'key-1',
    principal: 'api_key',
    outcome: 'denied',
    errorCode: 'UNAUTHORIZED',
    durationMs: 42,
    isMutation: false,
    correlationId: 'corr-123',
    argKeys: ['q', injected],
    unexpectedSecret: 'must-not-appear-in-summary',
  },
  createdAt: '2026-11-16T10:00:00.000Z',
}

describe('AccessLogsTable MCP outcome and details', () => {
  beforeEach(() => {
    registerCoreInjectionWidgets([])
    registerCoreInjectionTables([], [])
    registerEnabledModuleIds(['audit_logs'])
  })

  afterEach(() => cleanup())

  it('renders outcome and duration columns from the row context', async () => {
    renderWithProviders(<AccessLogsTable items={[mcpItem]} />, { dict: english })
    const row = (await screen.findByText(/customers\.list_deals/)).closest('tr') as HTMLElement
    expect(within(row).getByText('Denied')).toBeInTheDocument()
    expect(within(row).getByText('42 ms')).toBeInTheDocument()
  })

  it('opens a details dialog that shows allow-listed context as inert text', async () => {
    renderWithProviders(<AccessLogsTable items={[mcpItem]} />, { dict: english })
    fireEvent.click(await screen.findByText(/customers\.list_deals/))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('corr-123')).toBeInTheDocument()
    expect(within(dialog).getByText('key-1')).toBeInTheDocument()
    expect(within(dialog).getByText('UNAUTHORIZED')).toBeInTheDocument()
    expect(within(dialog).getByText(`q, ${injected}`)).toBeInTheDocument()
    expect(dialog.querySelector('img')).toBeNull()
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    expect(within(dialog).queryByText('must-not-appear-in-summary')).not.toBeInTheDocument()
  })

  it('closes the details dialog on Escape', async () => {
    renderWithProviders(<AccessLogsTable items={[mcpItem]} />, { dict: english })
    fireEvent.click(await screen.findByText(/customers\.list_deals/))
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
