import type { WorkflowDefinitionData } from '../data/entities'
import type { DefinitionValidationIssue } from './definition-error-body'
import type { ZodIssueLike } from './collect-validation-issues'
import { isSafeMappingTargetPath } from './safe-mapping-path'

export const UNSAFE_MAPPING_TARGET_MESSAGE_KEY = 'workflows.validation.unsafeMappingTarget'

export const UNSAFE_MAPPING_TARGET_MESSAGE =
  'Mapping target paths cannot contain __proto__, constructor, or prototype segments'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectMappingIssues(
  value: unknown,
  path: Array<string | number>,
  message: string,
): ZodIssueLike[] {
  if (!isRecord(value)) return []
  return Object.keys(value)
    .filter((targetPath) => !isSafeMappingTargetPath(targetPath))
    .map((targetPath) => ({
      path: [...path, targetPath],
      message,
    }))
}

function collectActivityIssues(
  activities: unknown,
  path: Array<string | number>,
  message: string,
): ZodIssueLike[] {
  if (!Array.isArray(activities)) return []
  return activities.flatMap((activity, activityIndex) => {
    if (!isRecord(activity) || activity.activityType !== 'INVOKE_AGENT') return []
    const config = isRecord(activity.config) ? activity.config : {}
    return collectMappingIssues(config.outputMapping, [
      ...path,
      activityIndex,
      'config',
      'outputMapping',
    ], message)
  })
}

export function collectUnsafeMappingTargetIssues(
  definition: WorkflowDefinitionData,
  message = UNSAFE_MAPPING_TARGET_MESSAGE,
): ZodIssueLike[] {
  const stepIssues = Array.isArray(definition.steps)
    ? definition.steps.flatMap((step, stepIndex) => {
        if (!isRecord(step)) return []
        const config = isRecord(step.config) ? step.config : {}
        const subWorkflowConfig = isRecord(step.subWorkflowConfig) ? step.subWorkflowConfig : {}
        const issues: ZodIssueLike[] = []

        if (step.stepType === 'SUB_WORKFLOW') {
          issues.push(
            ...collectMappingIssues(config.inputMapping, ['steps', stepIndex, 'config', 'inputMapping'], message),
            ...collectMappingIssues(config.outputMapping, ['steps', stepIndex, 'config', 'outputMapping'], message),
            ...collectMappingIssues(subWorkflowConfig.inputMapping, [
              'steps',
              stepIndex,
              'subWorkflowConfig',
              'inputMapping',
            ], message),
            ...collectMappingIssues(subWorkflowConfig.outputMapping, [
              'steps',
              stepIndex,
              'subWorkflowConfig',
              'outputMapping',
            ], message),
          )
        }
        if (step.stepType === 'PARALLEL_JOIN') {
          issues.push(
            ...collectMappingIssues(config.outputMapping, ['steps', stepIndex, 'config', 'outputMapping'], message),
          )
        }
        issues.push(...collectActivityIssues(step.activities, ['steps', stepIndex, 'activities'], message))
        return issues
      })
    : []

  const transitionIssues = Array.isArray(definition.transitions)
    ? definition.transitions.flatMap((transition, transitionIndex) => {
        if (!isRecord(transition)) return []
        return collectActivityIssues(transition.activities, [
          'transitions',
          transitionIndex,
          'activities',
        ], message)
      })
    : []

  return [...stepIssues, ...transitionIssues]
}

export function mappingTargetIssuesForApi(
  definition: WorkflowDefinitionData,
  prefix: Array<string | number> = [],
  message = UNSAFE_MAPPING_TARGET_MESSAGE,
): DefinitionValidationIssue[] {
  return collectUnsafeMappingTargetIssues(definition, message).map((issue) => ({
    path: [
      ...prefix,
      ...issue.path.map((segment) => (typeof segment === 'number' ? segment : String(segment))),
    ],
    code: 'custom',
    message: issue.message,
  }))
}
