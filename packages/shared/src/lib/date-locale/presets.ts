/** Sentinel stored for "follow the locale" in the settings UI. Never a `date-fns` pattern. */
export const DATE_LOCALE_AUTO = 'auto'

export const DATE_FORMAT_PRESETS = [
  'dd.MM.yyyy',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
  'yyyy-MM-dd',
  'd MMM yyyy',
  'MMM d, yyyy',
] as const

export const TIME_FORMAT_PRESETS = ['HH:mm', 'h:mm a'] as const

export const DATE_TIME_FORMAT_PRESETS = [
  'dd.MM.yyyy HH:mm',
  'dd/MM/yyyy HH:mm',
  'MM/dd/yyyy h:mm a',
  'yyyy-MM-dd HH:mm',
  'd MMM yyyy, HH:mm',
  'MMM d, yyyy, h:mm a',
] as const

export const FIRST_DAY_OF_WEEK_VALUES = [0, 1, 2, 3, 4, 5, 6] as const
