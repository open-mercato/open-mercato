/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import en from '../i18n/en.json'
import { AgentAccessSection } from '../backend/agents/[id]/components/AgentAccessSection'
import { mapAgent, mapAgentPrincipal } from '../components/types'

const mockApiCall = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockFlash = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  apiCallOrThrow: (...args: unknown[]) => mockApiCallOrThrow(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

const dict = en as Record<string, string>

const DECLARED_PRINCIPAL = {
  declared: true,
  provisioned: false,
  enabled: false,
  toolAcl: 'caller' as const,
  required: false,
  roleFeatures: ['claims.view'],
}

function grantFeatures(granted: string[]) {
  mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { granted } })
}

beforeEach(() => {
  mockApiCall.mockReset()
  mockApiCallOrThrow.mockReset()
  mockFlash.mockReset()
  grantFeatures([])
})

function renderSection(principal: React.ComponentProps<typeof AgentAccessSection>['principal']) {
  return renderWithProviders(<AgentAccessSection principal={principal} />, { dict })
}

describe('AgentAccessSection', () => {
  it('renders nothing for a caller who may not see the principal', () => {
    const { container } = renderSection(undefined)
    expect(container.innerHTML).toBe('')
  })

  it('explains that an agent without a principal acts as its invoker', () => {
    renderSection(null)
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.access.title'])).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.access.none'])).toBeTruthy()
  })

  it('shows provisioned and enabled badges, tool ACL mode, required flag and role features', () => {
    renderSection({
      declared: true,
      provisioned: true,
      enabled: true,
      toolAcl: 'intersect',
      required: true,
      roleFeatures: ['claims.update', 'claims.view'],
    })
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.access.provisioned'])).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.access.enabled'])).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.access.toolAclMode.intersect'])).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.access.requiredYes'])).toBeTruthy()
    expect(screen.getByText('claims.update')).toBeTruthy()
    expect(screen.getByText('claims.view')).toBeTruthy()
  })

  it('shows an unprovisioned declared principal without an enabled badge', () => {
    renderSection({ declared: true, provisioned: false, enabled: false, toolAcl: 'caller', required: false, roleFeatures: [] })
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.access.notProvisioned'])).toBeTruthy()
    expect(screen.queryByText(dict['agent_orchestrator.agentDetail.access.enabled'])).toBeNull()
    expect(screen.queryByText(dict['agent_orchestrator.agentDetail.access.disabled'])).toBeNull()
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.access.toolAclMode.caller'])).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.access.requiredNo'])).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.access.noFeatures'])).toBeTruthy()
  })

  it('marks a separately registered principal as undeclared and disabled', () => {
    renderSection({ declared: false, provisioned: true, enabled: false, toolAcl: 'caller', required: false })
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.access.disabled'])).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.access.undeclared'])).toBeTruthy()
  })
})

describe('AgentAccessSection sync principal', () => {
  const syncLabel = () => dict['agent_orchestrator.agentDetail.access.sync.action']

  it('shows the sync button to identity.manage holders, including through a wildcard', async () => {
    grantFeatures(['agent_orchestrator.*'])
    renderWithProviders(<AgentAccessSection principal={DECLARED_PRINCIPAL} agentId="claims.triage" />, { dict })
    expect(await screen.findByRole('button', { name: syncLabel() })).toBeTruthy()
    const [path, init] = mockApiCall.mock.calls[0]
    expect(path).toBe('/api/auth/feature-check')
    expect(JSON.parse(String(init.body))).toEqual({ features: ['agent_orchestrator.identity.manage'] })
  })

  it('hides the sync button without identity.manage', async () => {
    grantFeatures(['agent_orchestrator.agents.manage'])
    renderWithProviders(<AgentAccessSection principal={DECLARED_PRINCIPAL} agentId="claims.triage" />, { dict })
    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: syncLabel() })).toBeNull()
  })

  it('offers no sync for an agent that declares no principal', () => {
    grantFeatures(['agent_orchestrator.identity.manage'])
    renderWithProviders(<AgentAccessSection principal={null} agentId="plain.agent" />, { dict })
    expect(screen.queryByRole('button', { name: syncLabel() })).toBeNull()
    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('syncs the agent, flashes success and hands back the refreshed principal', async () => {
    grantFeatures(['agent_orchestrator.identity.manage'])
    mockApiCallOrThrow.mockResolvedValue({
      ok: true,
      status: 200,
      result: { principal: { ...DECLARED_PRINCIPAL, provisioned: true, enabled: true } },
    })
    const onPrincipalChange = jest.fn()
    renderWithProviders(
      <AgentAccessSection principal={DECLARED_PRINCIPAL} agentId="claims.triage" onPrincipalChange={onPrincipalChange} />,
      { dict },
    )
    fireEvent.click(await screen.findByRole('button', { name: syncLabel() }))
    await waitFor(() => expect(onPrincipalChange).toHaveBeenCalled())
    expect(mockApiCallOrThrow.mock.calls[0][0]).toBe('/api/agent_orchestrator/agents/claims.triage/principal/sync')
    expect(mockApiCallOrThrow.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(onPrincipalChange).toHaveBeenCalledWith({ ...DECLARED_PRINCIPAL, provisioned: true, enabled: true })
    expect(mockFlash).toHaveBeenCalledWith(dict['agent_orchestrator.agentDetail.access.sync.success'], 'success')
  })

  it('flashes an error and keeps the principal when the sync fails', async () => {
    grantFeatures(['agent_orchestrator.identity.manage'])
    mockApiCallOrThrow.mockRejectedValue(new Error('boom'))
    const onPrincipalChange = jest.fn()
    renderWithProviders(
      <AgentAccessSection principal={DECLARED_PRINCIPAL} agentId="claims.triage" onPrincipalChange={onPrincipalChange} />,
      { dict },
    )
    fireEvent.click(await screen.findByRole('button', { name: syncLabel() }))
    await waitFor(() =>
      expect(mockFlash).toHaveBeenCalledWith(dict['agent_orchestrator.agentDetail.access.sync.error'], 'error'),
    )
    expect(onPrincipalChange).not.toHaveBeenCalled()
  })
})

describe('mapAgentPrincipal', () => {
  it('keeps the principal undefined when the API omits it and null when it is null', () => {
    expect(mapAgent({ id: 'a' })).not.toHaveProperty('principal')
    expect(mapAgent({ id: 'a', principal: null })?.principal).toBeNull()
  })

  it('normalizes unknown values defensively', () => {
    expect(mapAgentPrincipal({ declared: true, provisioned: 'yes', toolAcl: 'bogus', roleFeatures: ['a', 1] })).toEqual({
      declared: true,
      provisioned: false,
      enabled: false,
      toolAcl: 'caller',
      required: false,
      roleFeatures: ['a'],
    })
  })
})
