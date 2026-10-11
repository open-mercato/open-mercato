/**
 * Workflows Module - Component Guard
 *
 * A `kind: 'component'` definition is a reusable library item: it has no event
 * trigger and cannot be started as a standalone instance — it is invoked only
 * as a SUB_WORKFLOW. This guard is applied on the manual instance-start path
 * (api/instances) and intentionally NOT inside `startWorkflow`, so sub-workflow
 * invocation of a component keeps working.
 */

export function isComponentKind(kind: string | null | undefined): boolean {
  return kind === 'component'
}
