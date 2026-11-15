/**
 * Default regex patterns for the format-typed field registrations (Phase B
 * of `.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
 *
 * Phase A registers the catalogue so the studio's pattern editor can offer a
 * "Standard format" chip even on plain `text` / `textarea` fields. Phases B
 * later register the `email` / `phone` / `website` field types whose
 * descriptors seed the pattern at read time.
 */

export const FIELD_TYPE_DEFAULT_PATTERNS: Record<string, string> = {
  email: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
  phone: '^\\+?[0-9\\s\\-().]{6,32}$',
  website: '^https?://[^\\s]+$',
}

export const FIELD_TYPE_PATTERN_LABEL_KEY: Record<string, string> = {
  email: 'forms.studio.validation.pattern.standard.email',
  phone: 'forms.studio.validation.pattern.standard.phone',
  website: 'forms.studio.validation.pattern.standard.website',
}
