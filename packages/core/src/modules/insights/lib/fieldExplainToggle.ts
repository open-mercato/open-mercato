export const INSIGHTS_FIELD_EXPLAIN_TOGGLE_ID = 'insights_field_explain'

export const INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION = {
  identifier: INSIGHTS_FIELD_EXPLAIN_TOGGLE_ID,
  name: 'Insights field explain',
  description: 'Show the "Explain fields" switch and the per-field "Why?" buttons on supported edit forms. Disable to hide them.',
  category: 'insights',
  type: 'boolean' as const,
  defaultValue: true,
} as const
