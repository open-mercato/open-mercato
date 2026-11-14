/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import pl from '../../i18n/pl.json'
import { TASK_DEADLINE_MESSAGES } from '../../data/task-primitives'
import {
  buildRuntimeErrorMessageDetail,
  formatRuntimeErrorFallback,
} from '../../lib/runtime-error-message'
import { MobileInstanceOverview } from '../mobile/MobileInstanceOverview'
import { RunStepInspector } from '../run/RunStepInspector'

const mockTranslate = createFallbackTranslator(pl as Record<string, string>)

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, string>) =>
    mockTranslate(key, fallback ?? key, params ?? {}),
}))

jest.mock('../WorkflowGraph', () => ({ WorkflowGraphReadOnly: () => null }))
jest.mock('../mobile/MobileWorkflowTimeline', () => ({ MobileWorkflowTimeline: () => null }))

const { key, fallback } = TASK_DEADLINE_MESSAGES.invalidResolvedAt
const params = { authored: '{{context.dueDate}}', resolved: 'soon' }
const english = formatRuntimeErrorFallback(fallback, params)
const details = { stepId: 'review', ...buildRuntimeErrorMessageDetail(key, params) }

describe('a failed deadline reads in the reader\'s locale', () => {
  it('on the mobile instance overview', () => {
    render(
      <MobileInstanceOverview
        {...({
          instance: {
            status: 'FAILED',
            errorMessage: english,
            errorDetails: details,
            context: {},
            startedAt: new Date().toISOString(),
          },
          events: [],
          graphNodes: [],
          graphEdges: [],
          definitionLoading: false,
          hasDefinition: false,
          getStatusBadgeClass: () => '',
          getEventTypeBadgeClass: () => '',
          calculateDuration: () => '',
        } as unknown as React.ComponentProps<typeof MobileInstanceOverview>)}
      />,
    )
    expect(screen.getByText(/dało wartość "soon"/)).toBeTruthy()
    expect(screen.queryByText(/resolved to "soon"/)).toBeNull()
  })

  it('in the run step inspector', () => {
    render(
      <RunStepInspector
        stepId="review"
        executions={[
          {
            id: 'step-1',
            stepId: 'review',
            stepName: 'Review',
            status: 'FAILED',
            errorData: { error: english, details },
          } as never,
        ]}
      />,
    )
    expect(document.body.textContent).toContain('dało wartość')
    expect(document.body.textContent).not.toContain('resolved to')
  })
})
