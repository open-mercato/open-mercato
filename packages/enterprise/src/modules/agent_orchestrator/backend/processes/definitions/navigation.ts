/** Canonical backend hrefs for the process-definition surface (spec 2026-08-11). */
export const PROCESS_DEFINITIONS_HREF = '/backend/processes/definitions'

export function processDefinitionHref(id: string): string {
  return `${PROCESS_DEFINITIONS_HREF}/${id}`
}
