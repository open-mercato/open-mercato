/**
 * @jest-environment node
 *
 * Repo-wide guard for #4232: every activity in a code-defined workflow this
 * repo ships must satisfy `activityDefinitionSchema`, which now requires the
 * config keys each executor reads at run time. Generalizes the EMIT_EVENT-only
 * guard added for #4322 — a shipped example whose activity config the executor
 * cannot use is a bug we hand to every install.
 */
import { activityDefinitionSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { workflowsConfig as coreWorkflows } from '@open-mercato/core/modules/workflows/workflows'
import { workflowsConfig as salesWorkflows } from '@open-mercato/core/modules/sales/workflows'

type ShippedActivity = {
  label: string
  activity: unknown
}

function collectActivities(
  moduleId: string,
  config: { workflows: Array<{ workflowId: string; definition: Record<string, unknown> }> },
): ShippedActivity[] {
  const collected: ShippedActivity[] = []
  for (const workflow of config.workflows) {
    const definition = workflow.definition as {
      steps?: Array<{ stepId?: string; activities?: unknown[] }>
      transitions?: Array<{ transitionId?: string; activities?: unknown[] }>
    }
    for (const step of definition.steps ?? []) {
      for (const activity of step.activities ?? []) {
        collected.push({
          label: `${moduleId} / ${workflow.workflowId} / step ${step.stepId} / ${(activity as { activityId?: string }).activityId}`,
          activity,
        })
      }
    }
    for (const transition of definition.transitions ?? []) {
      for (const activity of transition.activities ?? []) {
        collected.push({
          label: `${moduleId} / ${workflow.workflowId} / transition ${transition.transitionId} / ${(activity as { activityId?: string }).activityId}`,
          activity,
        })
      }
    }
  }
  return collected
}

const shippedActivities = [
  ...collectActivities('workflows', coreWorkflows as never),
  ...collectActivities('sales', salesWorkflows as never),
]

describe('shipped code-defined workflow activities', () => {
  test('there are shipped activities to guard', () => {
    expect(shippedActivities.length).toBeGreaterThan(0)
  })

  test.each(shippedActivities.map((entry) => [entry.label, entry.activity] as const))(
    '%s has a config its executor can run',
    (label, activity) => {
      const result = activityDefinitionSchema.safeParse(activity)
      const problems = result.success
        ? ''
        : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      expect(problems).toBe('')
    },
  )
})
