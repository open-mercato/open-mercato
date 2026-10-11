/**
 * The Invoke Agent node's Review section, editor side (spec §7.5).
 *
 * Two properties carry the weight:
 *  - a step that never opened the section serializes byte-identically to one
 *    authored before it existed ("absent stays absent");
 *  - the section round-trips through the node form, so what an author reads is
 *    what a save would persist.
 */

import { describe, test, expect } from '@jest/globals'
import type { Node } from '@xyflow/react'
import {
  agentReviewToFormValues,
  formValuesToAgentReview,
  AGENT_REVIEW_ASSIGNMENT_MODES,
  AGENT_REVIEW_ON_BREACH_ACTIONS,
} from '../agent-review-inspector'
import { formValuesToNodeUpdates, nodeToFormValues } from '../nodeFormTransforms'
import type { NodeFormValues } from '../nodeFormTransforms'

const makeAgentNode = (config: Record<string, unknown>): Node =>
  ({
    id: 'agent_step',
    type: 'invokeAgent',
    position: { x: 0, y: 0 },
    data: {
      label: 'Enrich the deal',
      activities: [
        { activityId: 'invoke_agent', activityName: 'Invoke Agent', activityType: 'INVOKE_AGENT', config },
      ],
    },
  }) as unknown as Node

describe('agent review drafts', () => {
  test('an untouched section persists nothing', () => {
    expect(formValuesToAgentReview(agentReviewToFormValues(null))).toBeUndefined()
    expect(formValuesToAgentReview(undefined)).toBeUndefined()
  })

  test('the assignment tab is derived from the assignee, never stored', () => {
    expect(agentReviewToFormValues({ assignedToRoles: ['Sales Rep'] }).reviewAssignmentMode).toBe('role')
    expect(agentReviewToFormValues({ assignedTo: 'user-1' }).reviewAssignmentMode).toBe('user')
    expect(
      agentReviewToFormValues({ assignedTo: '{{context.deal.ownerId}}' }).reviewAssignmentMode,
    ).toBe('dynamic')
  })

  test('the Role tab never persists an individual assignee', () => {
    const review = formValuesToAgentReview({
      reviewAssignmentMode: 'role',
      reviewAssignedTo: 'left-over',
      reviewAssignedToRoles: ['Sales Rep'],
    })

    expect(review).toEqual({ assignedToRoles: ['Sales Rep'] })
  })

  test('only the qualifier the chosen breach action uses is persisted', () => {
    expect(
      formValuesToAgentReview({ reviewOnBreach: { action: 'notify', reassignTo: 'Supervisor' } }),
    ).toEqual({ onBreach: { action: 'notify' } })
    expect(
      formValuesToAgentReview({ reviewOnBreach: { action: 'reassign', reassignTo: 'Supervisor' } }),
    ).toEqual({ onBreach: { action: 'reassign', reassignTo: 'Supervisor' } })
  })

  test('the section offers no route and no verdict', () => {
    expect([...AGENT_REVIEW_ON_BREACH_ACTIONS]).toEqual(['notify', 'reassign', 'attention'])
    // A proposal is disposed from the backoffice caseload, so the Rule tab has
    // no engine behind it and is not offered.
    expect([...AGENT_REVIEW_ASSIGNMENT_MODES]).toEqual(['role', 'user', 'dynamic'])
  })
})

describe('agent review through the node form', () => {
  test('round-trips a fully authored section', () => {
    const review = {
      assignedTo: '{{context.deal.ownerId}}',
      assignedToRoles: ['Sales Rep'],
      priority: 'high',
      deadline: { duration: 'P2D' },
      reminders: [{ offset: 'PT4H' }],
      onBreach: { action: 'attention' },
    }
    const node = makeAgentNode({ agentId: 'deal_enricher', onResult: { alwaysAsk: true }, review })

    const values = nodeToFormValues(node)
    expect(values.reviewAssignmentMode).toBe('dynamic')
    expect(values.reviewReminders).toEqual(['PT4H'])

    const updates = formValuesToNodeUpdates(values as NodeFormValues, node)
    const saved = (updates.activities as { config?: Record<string, unknown> }[])[0].config

    expect(saved?.review).toEqual(review)
  })

  test('a step with no Review saves no Review key at all', () => {
    const node = makeAgentNode({ agentId: 'deal_enricher', onResult: { alwaysAsk: true } })

    const updates = formValuesToNodeUpdates(nodeToFormValues(node) as NodeFormValues, node)
    const saved = (updates.activities as { config?: Record<string, unknown> }[])[0].config

    expect(saved).not.toHaveProperty('review')
  })

  test('a cleared Review is removed, not resurrected from the previous config', () => {
    const node = makeAgentNode({
      agentId: 'deal_enricher',
      onResult: { alwaysAsk: true },
      review: { assignedToRoles: ['Sales Rep'] },
    })

    const values = { ...nodeToFormValues(node), reviewAssignedToRoles: [] } as NodeFormValues
    const updates = formValuesToNodeUpdates(values, node)
    const saved = (updates.activities as { config?: Record<string, unknown> }[])[0].config

    expect(saved).not.toHaveProperty('review')
  })
})
