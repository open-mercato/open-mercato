import '../lib/activity-registry-bootstrap'
import { getActivityType } from '../lib/activity-registry'

/**
 * Advisory per-type activity config validation (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.2, Phase 1 severity
 * contract): each activity's config is checked against its registry
 * configSchema, and failures are returned as WARNING entries — never added to
 * the definition schema itself — so legacy definitions that predate per-type
 * validation keep saving through both the editor and the API. Strict mode
 * arrives with Phase 2's opt-in.
 */

export interface ActivityConfigWarning {
  path: Array<string | number>
  message: string
}

interface ActivityLike {
  activityType?: unknown
  config?: unknown
}

function collectFromContainers(
  collection: 'steps' | 'transitions',
  containers: unknown,
  warnings: ActivityConfigWarning[],
): void {
  if (!Array.isArray(containers)) return
  containers.forEach((container, containerIndex) => {
    const activities =
      container && typeof container === 'object'
        ? (container as { activities?: unknown }).activities
        : undefined
    if (!Array.isArray(activities)) return
    activities.forEach((activity, activityIndex) => {
      const { activityType, config } =
        activity && typeof activity === 'object' ? (activity as ActivityLike) : {}
      if (typeof activityType !== 'string') return
      const entry = getActivityType(activityType)
      if (!entry) return
      const result = entry.configSchema.safeParse(config ?? {})
      if (result.success) return
      for (const issue of result.error.issues) {
        warnings.push({
          path: [
            collection,
            containerIndex,
            'activities',
            activityIndex,
            'config',
            ...issue.path.map((segment) =>
              typeof segment === 'symbol' ? String(segment) : segment,
            ),
          ],
          message: issue.message,
        })
      }
    })
  })
}

export function collectActivityConfigWarnings(definition: {
  steps?: unknown
  transitions?: unknown
}): ActivityConfigWarning[] {
  const warnings: ActivityConfigWarning[] = []
  collectFromContainers('steps', definition?.steps, warnings)
  collectFromContainers('transitions', definition?.transitions, warnings)
  return warnings
}
