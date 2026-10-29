// packages/ui/src/backend/utils/groupLabels.ts

// Stable, locale-independent identity for the "no declared group" bucket. Grouping and
// collapse state key on this sentinel so two locales never split one bucket in two.
export const UNGROUPED_GROUP_ID = '__om_ungrouped__'

const TRANSLATION_KEY_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/

// Group strings reach these components from two very different places: code literals a
// module author controls, and free text a tenant types into the custom-field fieldset
// editor. Only the former may be resolved as a translation key, so tenant data is never
// silently reinterpreted as a dictionary lookup.
export function isTranslationKeyShaped(group: string): boolean {
  return TRANSLATION_KEY_PATTERN.test(group)
}

export function resolveGroupLabel(
  translate: (key: string, fallback?: string) => string,
  group: string,
  ungroupedKey: string,
  ungroupedFallback: string,
): string {
  if (group === UNGROUPED_GROUP_ID) return translate(ungroupedKey, ungroupedFallback)
  if (!isTranslationKeyShaped(group)) return group
  return translate(group, group)
}
