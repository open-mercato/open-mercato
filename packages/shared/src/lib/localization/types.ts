/**
 * A translation record maps locale codes to field-value overlays.
 * Example: { "de": { "title": "Recyceltes PP-Granulat" }, "es": { "title": "Granulado" } }
 */
export type TranslationRecord = Record<string, Record<string, unknown>>

export type LocaleCode = string
