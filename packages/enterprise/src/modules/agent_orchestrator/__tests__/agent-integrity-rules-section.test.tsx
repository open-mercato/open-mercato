/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import en from '../i18n/en.json'
import { AgentIntegrityRulesSection } from '../backend/agents/[id]/components/AgentIntegrityRulesSection'

const dict = en as Record<string, string>

describe('AgentIntegrityRulesSection', () => {
  it('renders nothing for an agent without integrity rules', () => {
    const { container } = renderWithProviders(
      <AgentIntegrityRulesSection agent={{ integrityRules: [], integritySetVersion: null }} />,
      { dict },
    )
    expect(container.innerHTML).toBe('')
  })

  it('lists each declared rule with its violation handling and the set version', () => {
    renderWithProviders(
      <AgentIntegrityRulesSection
        agent={{
          integrityRules: [{ id: 'cited', kind: 'tool_consulted', onViolation: 'flag', reviewRoute: null }],
          integritySetVersion: 'sha256:abc',
        }}
      />,
      { dict },
    )
    expect(screen.getByRole('list', { name: dict['agent_orchestrator.agentDetail.integrity.title'] })).toBeTruthy()
    expect(screen.getByText('cited')).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.agentDetail.integrity.onViolation.flag'])).toBeTruthy()
    expect(screen.getByText('sha256:abc')).toBeTruthy()
  })
})
