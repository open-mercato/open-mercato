import path from 'node:path'
import fs from 'node:fs'
import { describe, expect, test } from '@jest/globals'
import { eventsConfig } from '../events'
import { aiTools } from '../ai-tools'

describe('agent_governance contract surfaces', () => {
  test('keeps frozen event ids stable', () => {
    const eventIds = new Set(eventsConfig.events.map((event) => event.id))

    const requiredEventIds = [
      'agent_governance.run.started',
      'agent_governance.run.paused',
      'agent_governance.run.terminated',
      'agent_governance.approval.requested',
      'agent_governance.approval.resolved',
      'agent_governance.decision.recorded',
      'agent_governance.precedent.indexed',
      'agent_governance.skill.promoted',
    ]

    for (const eventId of requiredEventIds) {
      expect(eventIds.has(eventId)).toBe(true)
    }
  })

  test('keeps MCP tool names stable for v2 and legacy aliases', () => {
    const names = new Set(aiTools.map((tool) => tool.name))

    const requiredToolNames = [
      'agent_run',
      'risk_check',
      'precedent_search',
      'precedent_explain',
      'context_expand',
      'skill_capture',
      'agent_governance_run',
      'agent_governance_risk_check',
      'agent_governance_precedent_search',
      'agent_governance_precedent_explain',
      'agent_governance_context_expand',
      'agent_governance_skill_capture',
    ]

    for (const toolName of requiredToolNames) {
      expect(names.has(toolName)).toBe(true)
    }
  })

  test('keeps API route files for frozen URLs present', () => {
    const moduleDir = path.resolve(__dirname, '..')

    const requiredRouteFiles = [
      'api/policies/route.ts',
      'api/risk-bands/route.ts',
      'api/playbooks/route.ts',
      'api/runs/route.ts',
      'api/runs/[id]/route.ts',
      'api/runs/[id]/reroute/route.ts',
      'api/approvals/route.ts',
      'api/approvals/[id]/approve/route.ts',
      'api/approvals/[id]/reject/route.ts',
      'api/precedents/search/route.ts',
      'api/precedents/explain/route.ts',
      'api/context-graph/neighbors/route.ts',
      'api/skills/route.ts',
      'api/skills/[id]/promote/route.ts',
    ]

    for (const relativePath of requiredRouteFiles) {
      expect(fs.existsSync(path.join(moduleDir, relativePath))).toBe(true)
    }
  })
})
