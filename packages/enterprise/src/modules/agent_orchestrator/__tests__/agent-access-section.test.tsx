/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import en from '../i18n/en.json'
import { AgentAccessSection } from '../backend/agents/[id]/components/AgentAccessSection'
import { mapAgent, mapAgentPrincipal } from '../components/types'

const dict = en as Record<string, string>

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
