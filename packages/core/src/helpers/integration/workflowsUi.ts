import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Shared browser-side helpers for the workflow Studio specs.
 *
 * The Studio is the ONLY workflow editor (workflows/AGENTS.md → "The Form Editor
 * Is Retired"). Three facts about it broke every spec written against the old
 * form editor, and each of them is centralised here so a future move is one
 * edit rather than twenty:
 *
 * 1. **Definition metadata lives in a modal Drawer that starts CLOSED.**
 *    `workflowId` / `workflowName` / `description` / triggers / `contextSchema`
 *    are inside `DefinitionMetadataDrawer`, reachable only through
 *    `data-testid="workflow-details-trigger"`. They are plain `Input`s with
 *    `id=` — there is no `data-crud-field-id` on definition metadata (that
 *    attribute survives only inside the step/route inspectors, which do use
 *    `CrudForm`).
 * 2. **The canvas carries one synthetic node and one synthetic edge.** The
 *    trigger pill (`lib/trigger-node.ts`) is minted at render time whenever the
 *    definition has a START step, so `.react-flow__node` is always
 *    `steps.length + 1`. Count through `workflowStepNodes` / `workflowRouteEdges`.
 * 3. **The step and route inspectors are a DOCKED RAIL, not a modal.** At
 *    >=1280px they render as `<aside role="complementary"
 *    data-slot="workflow-inspector" data-variant="docked">` inside
 *    `[data-testid="workflow-editor-row"]`, so `getByRole('dialog')` matches
 *    nothing. Below 1280px the same content renders in a modal `Drawer`;
 *    `workflowInspector` matches either.
 */

export const WORKFLOW_TRIGGER_NODE_ID = '__workflow_trigger__'
export const WORKFLOW_TRIGGER_EDGE_ID = '__workflow_trigger_edge__'

export const WORKFLOW_DETAILS_TRIGGER_TESTID = 'workflow-details-trigger'
export const WORKFLOW_DETAILS_DRAWER_TITLE = 'Workflow details'
export const WORKFLOW_INSPECTOR_SELECTOR = '[data-slot="workflow-inspector"]'

export function visualEditorHref(definitionId?: string | null): string {
  return definitionId
    ? `/backend/definitions/visual-editor?id=${encodeURIComponent(definitionId)}`
    : '/backend/definitions/visual-editor'
}

/**
 * The author's steps, without the render-time trigger pill.
 */
export function workflowStepNodes(page: Page): Locator {
  return page.locator(`.react-flow__node:not([data-id="${WORKFLOW_TRIGGER_NODE_ID}"])`)
}

/**
 * The author's routes, without the trigger pill's connector.
 */
export function workflowRouteEdges(page: Page): Locator {
  return page.locator(`.react-flow__edge:not([data-id="${WORKFLOW_TRIGGER_EDGE_ID}"])`)
}

/**
 * The step/route inspector, docked at >=1280px and a modal Drawer below it.
 * Distinguish the two by heading: "Edit Step" vs "Edit Transition".
 */
export function workflowInspector(page: Page): Locator {
  return page.locator(WORKFLOW_INSPECTOR_SELECTOR)
}

export function workflowDetailsDrawer(page: Page): Locator {
  return page.getByRole('dialog', { name: WORKFLOW_DETAILS_DRAWER_TITLE })
}

/**
 * Open the Studio on an existing definition and wait for the canvas to paint.
 *
 * Goes straight to `/backend/definitions/visual-editor?id=…` rather than through
 * the `/backend/definitions/<id>` bridge route: the bridge only exists so old
 * bookmarks keep working and costs a client-side `router.replace`.
 */
export async function openWorkflowStudio(page: Page, definitionId: string): Promise<void> {
  await page.goto(visualEditorHref(definitionId))
  await expect(workflowStepNodes(page).first()).toBeVisible({ timeout: 30_000 })
}

/**
 * Open the definition-metadata drawer and wait for it.
 *
 * Every metadata field is unmounted until this runs, which is why so many specs
 * time out on a field that does still exist.
 */
export async function openWorkflowDetailsDrawer(page: Page): Promise<Locator> {
  const drawer = workflowDetailsDrawer(page)
  if (!(await drawer.isVisible().catch(() => false))) {
    await page.getByTestId(WORKFLOW_DETAILS_TRIGGER_TESTID).click()
  }
  await expect(drawer).toBeVisible({ timeout: 15_000 })
  return drawer
}

/**
 * Save from INSIDE the drawer.
 *
 * With the drawer open there are two buttons named `Save`/`Update` — the page
 * header's and the drawer footer's — so an unscoped `getByRole('button', …)`
 * fails Playwright's strict mode. The drawer's button submits the same
 * `handleSave`, header and all.
 */
export async function saveWorkflowFromDetailsDrawer(page: Page): Promise<void> {
  const drawer = workflowDetailsDrawer(page)
  await drawer.getByRole('button', { name: /^(save|update)$/i }).click()
}
