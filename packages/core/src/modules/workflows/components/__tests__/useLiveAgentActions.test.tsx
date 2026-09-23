/**
 * @jest-environment jsdom
 *
 * Live agent-action telemetry over the DOM Event Bridge (workflows spec Phase 2).
 */
import * as React from 'react'
import { act, render } from '@testing-library/react'
import { APP_EVENT_DOM_NAME } from '@open-mercato/ui/backend/injection/useAppEvent'
import {
  useLiveAgentActions,
  MAX_LIVE_AGENT_ACTIONS,
  type LiveAgentAction,
} from '../run/useLiveAgentActions'

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111'

function emit(payload: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(APP_EVENT_DOM_NAME, {
        detail: { id: 'workflows.agent.action', payload, timestamp: Date.now(), organizationId: 'org-1' },
      })
    )
  })
}

type ProbeProps = Parameters<typeof useLiveAgentActions>[0] & {
  onActions: (actions: LiveAgentAction[]) => void
}

function Probe({ onActions, ...options }: ProbeProps) {
  const actions = useLiveAgentActions(options)
  onActions(actions)
  return null
}

describe('useLiveAgentActions', () => {
  it('accumulates matching agent actions in order', () => {
    let latest: LiveAgentAction[] = []
    render(<Probe instanceId={INSTANCE_ID} onActions={(a) => { latest = a }} />)

    emit({ id: INSTANCE_ID, kind: 'step_finish', stepIndex: 0, toolCallCount: 0 })
    emit({ id: INSTANCE_ID, kind: 'tool_call', name: 'workflows.validate_workflow_definition', stepIndex: 1, toolCallCount: 1 })

    expect(latest).toHaveLength(2)
    expect(latest[1].kind).toBe('tool_call')
    expect(latest[1].name).toBe('workflows.validate_workflow_definition')
  })

  it('ignores actions for a different instance', () => {
    let latest: LiveAgentAction[] = []
    render(<Probe instanceId={INSTANCE_ID} onActions={(a) => { latest = a }} />)

    emit({ id: 'some-other-instance', kind: 'step_finish', stepIndex: 0, toolCallCount: 0 })

    expect(latest).toHaveLength(0)
  })

  it('does nothing while disabled', () => {
    let latest: LiveAgentAction[] = []
    render(<Probe instanceId={INSTANCE_ID} enabled={false} onActions={(a) => { latest = a }} />)

    emit({ id: INSTANCE_ID, kind: 'step_finish', stepIndex: 0, toolCallCount: 0 })

    expect(latest).toHaveLength(0)
  })

  it('caps the log at MAX_LIVE_AGENT_ACTIONS', () => {
    let latest: LiveAgentAction[] = []
    render(<Probe onActions={(a) => { latest = a }} />)

    for (let index = 0; index < MAX_LIVE_AGENT_ACTIONS + 10; index += 1) {
      emit({ id: 'anything', kind: 'step_finish', stepIndex: index, toolCallCount: 0 })
    }

    expect(latest).toHaveLength(MAX_LIVE_AGENT_ACTIONS)
  })
})
