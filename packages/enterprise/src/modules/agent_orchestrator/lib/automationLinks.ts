import { WORKFLOW_STUDIO_CREATE_HREF } from '@open-mercato/core/modules/workflows/lib/visual-editor-navigation'

/**
 * Where the cockpit sends someone who has to leave the Agents group and go
 * build the automation that invokes an agent (F2/F5).
 *
 * The two hrefs live here rather than inline so the cross-group bridge has one
 * definition: the editor entry point is re-exported from the workflows module's
 * own helper (the retired form-create route forwards there), and the list href
 * is the only literal this module owns.
 */
export const WORKFLOW_DEFINITIONS_HREF = '/backend/definitions'

export const AUTOMATION_EDITOR_HREF = WORKFLOW_STUDIO_CREATE_HREF

/** ACL feature a user needs before the "build an automation" actions are offered. */
export const AUTOMATION_AUTHOR_FEATURE = 'workflows.definitions.create'

/** ACL feature a user needs to merely see the automations list. */
export const AUTOMATION_VIEW_FEATURE = 'workflows.definitions.view'
