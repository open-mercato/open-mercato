/**
 * Workflows Module - Visual Editor Navigation Helpers
 *
 * Small pure helpers for drilling into a referenced sub-workflow ("Otwórz
 * środek"): build the child editor href and extract the child definition's row
 * id from the definitions list API response.
 */

/**
 * The Studio's blank/template-picker entry point. The retired form-create route
 * forwards here (spec section 10), and the definitions list opens the template
 * gallery which lands on the same page.
 */
export const WORKFLOW_STUDIO_CREATE_HREF = '/backend/definitions/visual-editor'

export function buildVisualEditorHref(definitionId: string): string {
  return `/backend/definitions/visual-editor?id=${encodeURIComponent(definitionId)}`
}

/**
 * Pull the first definition row id from a `GET /api/workflows/definitions`
 * response. Returns null when the list is empty or malformed.
 */
export function extractFirstDefinitionId(
  payload: { data?: Array<{ id?: string }> } | null | undefined,
): string | null {
  const first = payload?.data?.[0]
  return first && typeof first.id === 'string' && first.id.length > 0 ? first.id : null
}
