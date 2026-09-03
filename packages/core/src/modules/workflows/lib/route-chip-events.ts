/**
 * Workflows Module - Route Chip Events
 *
 * Chips live inside React Flow's `EdgeLabelRenderer` portal, so a chip click
 * never reaches the canvas' `onEdgeClick`. The chip therefore announces itself
 * on `window` and the visual editor listens — the same decoupling the inline
 * node-delete button uses (`WORKFLOW_NODE_DELETE_EVENT`), so no callback has to
 * be threaded through the edge-data transform.
 */

import type { RouteChipSection } from './route-chips'

export const WORKFLOW_ROUTE_CHIP_EVENT = 'workflow-route-chip:open'

export interface RouteChipEventDetail {
  edgeId: string
  section: RouteChipSection
}

export function requestRouteChipSection(edgeId: string, section: RouteChipSection): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<RouteChipEventDetail>(WORKFLOW_ROUTE_CHIP_EVENT, { detail: { edgeId, section } }),
  )
}

/**
 * A single activity chip announces which activity it is, so the editor can open
 * a focused single-activity modal instead of the whole transition inspector.
 */
export const WORKFLOW_ROUTE_ACTIVITY_EVENT = 'workflow-route-activity:open'

export interface RouteActivityEventDetail {
  edgeId: string
  activityId: string
}

export function requestRouteActivityEdit(edgeId: string, activityId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<RouteActivityEventDetail>(WORKFLOW_ROUTE_ACTIVITY_EVENT, {
      detail: { edgeId, activityId },
    }),
  )
}
