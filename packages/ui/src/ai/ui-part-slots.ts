/**
 * Reserved UI-part component ids for Phase 3 approval cards.
 *
 * These ids match the server-emitted UI parts the mutation-approval runtime
 * will produce in Phase 3 Steps 5.6 and 5.10. They are listed here so the
 * registry contract can be validated at compile time and the default registry
 * ships with the same slot names the runtime will later emit.
 *
 * Hard rule: this tuple is FROZEN. Adding new reserved ids is additive, but
 * renaming or removing any entry is a breaking change per the backward-
 * compatibility contract (see `BACKWARD_COMPATIBILITY.md` §6 Widget injection
 * spot IDs).
 */
export const RESERVED_AI_UI_PART_IDS = Object.freeze([
  'mutation-preview-card',
  'field-diff-card',
  'confirmation-card',
  'mutation-result-card',
] as const)

export type ReservedAiUiPartId = (typeof RESERVED_AI_UI_PART_IDS)[number]

/**
 * Returns true when the given componentId is one of the Phase 3 reserved
 * slot identifiers. Used by the registry to flag seeded placeholders and by
 * debugging UIs (Step 4.6) to render reserved slots distinctly.
 */
export function isReservedAiUiPartId(
  componentId: string,
): componentId is ReservedAiUiPartId {
  return (RESERVED_AI_UI_PART_IDS as readonly string[]).includes(componentId)
}
