import type { TimeTrackingSettings } from '../time-tracking/settings'

export const TIME_TRACKING_SETTINGS_GENERAL_TAB = 'general'
export const TIME_TRACKING_SETTINGS_TAB_PARAM = 'tab'

/**
 * Context of the `staff.time_tracking.settings:tabs` spot. A tab owns its saves and does
 * not sit under the page's Save bar. When it writes the settings record itself it builds
 * the body from `settings` (the last saved record, never the page's unsaved draft) and
 * hands the response to `onSettingsSaved`, which rebases the page draft onto it.
 */
export type TimeTrackingSettingsTabContext = {
  moduleId: string
  canManage: boolean
  settings: TimeTrackingSettings
  onSettingsSaved: (settings: TimeTrackingSettings) => void
}
