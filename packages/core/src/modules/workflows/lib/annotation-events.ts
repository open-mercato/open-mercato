/**
 * Window bridge for annotation affordances rendered inside React Flow.
 *
 * Group collapse is toggled from a button inside the node, which React Flow
 * renders in its own transformed plane — the same reason the node delete button
 * and the route chips announce on `window` instead of bubbling a click the page
 * would have to reconstruct.
 */

export const WORKFLOW_GROUP_TOGGLE_EVENT = 'workflow-annotation:toggle-group'

export function requestWorkflowGroupToggle(nodeId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WORKFLOW_GROUP_TOGGLE_EVENT, { detail: { nodeId } }))
}
