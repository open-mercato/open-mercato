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
 *    are inside `DefinitionMetadataDrawer`, which the header does not expose
 *    directly: it is the `Settings` entry of the header's `More` menu
 *    (`ActionsDropdown`, so a `role="button"` named `More` opening
 *    `role="menuitem"`s). They are plain `Input`s with `id=` — there is no
 *    `data-crud-field-id` on definition metadata (that attribute survives only
 *    inside the step/route inspectors, which do use `CrudForm`).
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

/** Accessible name of the Studio header's overflow menu (`workflows.visualEditor.more`). */
export const WORKFLOW_MORE_MENU_LABEL = 'More'
/** The menu entry that opens the metadata drawer (`workflows.visualEditor.metadata.buttonLabel`). */
export const WORKFLOW_DETAILS_MENU_ITEM_LABEL = 'Settings'
/** The menu entry that drops a customized definition back to its code version. */
export const WORKFLOW_RESET_TO_CODE_MENU_ITEM_LABEL = 'Reset to code version'
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

/** The Studio header's overflow-menu trigger. */
export function workflowHeaderMenuTrigger(page: Page): Locator {
  return page.getByRole('button', { name: WORKFLOW_MORE_MENU_LABEL, exact: true })
}

/**
 * One entry of the header's overflow menu.
 *
 * `ActionsDropdown` renders entries as `<Button role="menuitem">`, so the
 * explicit role wins over the implicit one and `getByRole('button', …)` never
 * matches them — and nothing is in the DOM at all until the menu is open.
 */
export function workflowHeaderMenuItem(page: Page, label: string): Locator {
  return page.getByRole('menuitem', { name: label, exact: true })
}

/** Open the header's overflow menu, unless it is already open. */
export async function openWorkflowHeaderMenu(page: Page): Promise<void> {
  const trigger = workflowHeaderMenuTrigger(page)
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
}

/** Close the header's overflow menu, unless it is already closed. */
export async function closeWorkflowHeaderMenu(page: Page): Promise<void> {
  const trigger = workflowHeaderMenuTrigger(page)
  if ((await trigger.getAttribute('aria-expanded')) === 'true') await trigger.click()
}

/** Open the header's overflow menu and pick `label`. */
export async function invokeWorkflowHeaderAction(page: Page, label: string): Promise<void> {
  await openWorkflowHeaderMenu(page)
  await workflowHeaderMenuItem(page, label).click()
}

/**
 * Assert a header action is offered, then put the menu back as it was.
 *
 * The pre-Studio header rendered these as always-visible buttons, so specs used
 * to assert availability with a bare `toBeVisible()`; the equivalent now is
 * "the menu offers it".
 */
export async function expectWorkflowHeaderAction(
  page: Page,
  label: string,
  { available = true }: { available?: boolean } = {},
): Promise<void> {
  await openWorkflowHeaderMenu(page)
  const item = workflowHeaderMenuItem(page, label)
  if (available) await expect(item).toBeVisible()
  else await expect(item).toHaveCount(0)
  await closeWorkflowHeaderMenu(page)
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
    await invokeWorkflowHeaderAction(page, WORKFLOW_DETAILS_MENU_ITEM_LABEL)
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

/**
 * The Studio's "Show last run" execution overlay (spec §8.3).
 *
 * The toggle is off by default and PERSISTED per author
 * (`om:wf-editor-last-run`), and it fetches nothing until it is on — so a spec
 * must click it, and a spec must not assume a previous test left it on.
 */
export const WORKFLOW_LAST_RUN_TOGGLE_LABEL = 'Show the last run on the canvas'

export function workflowLastRunToggle(page: Page): Locator {
  return page.getByRole('button', { name: WORKFLOW_LAST_RUN_TOGGLE_LABEL })
}

/**
 * The run status the canvas painted for one step, read off the node card's
 * `data-node-status` attribute.
 *
 * The value is a `WorkflowStatus`, not the `StepRunStatus` the overlay derives:
 * each node component funnels `data.status` through `toWorkflowStatus`, which
 * collapses `active` to `in_progress` and anything it does not know (including
 * an absent status, i.e. the plain editor) to `not_started`.
 */
export function workflowNodeStatus(page: Page, stepId: string): Locator {
  return page.locator(`.react-flow__node[data-id="${stepId}"] [data-node-status]`).first()
}

/**
 * The visible stroke of one route. The overlay paints a TAKEN route by setting
 * the edge's `state` to `completed`, which reaches the DOM only as the inline
 * `stroke` (there is no `data-*` marker), so `EDGE_COLORS.completed.stroke` —
 * `var(--status-success-icon)` — is what a spec has to look for.
 */
export function workflowEdgePath(page: Page, transitionId: string): Locator {
  return page.locator(`.react-flow__edge[data-id="${transitionId}"] path.react-flow__edge-path`).first()
}

export const WORKFLOW_TAKEN_ROUTE_STROKE = 'var(--status-success-icon)'
