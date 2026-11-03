import type { FilterOptionTone } from '@open-mercato/shared/lib/query/advanced-filter'

// Saturated icon tokens shared by the kanban lane accent bar and the status filter
// pills, so both surfaces render the same tone identically (#5107 review).
export const TONE_DOT_CLASS: Record<FilterOptionTone, string> = {
  success: 'bg-status-success-icon',
  error: 'bg-status-error-icon',
  warning: 'bg-status-warning-icon',
  info: 'bg-status-info-icon',
  neutral: 'bg-status-neutral-icon',
  brand: 'bg-brand-violet',
  pink: 'bg-status-pink-icon',
}

export function toneToDotClass(
  tone: FilterOptionTone | null | undefined,
  fallback = 'bg-status-neutral-icon',
): string {
  if (tone && tone in TONE_DOT_CLASS) return TONE_DOT_CLASS[tone]
  return fallback
}
