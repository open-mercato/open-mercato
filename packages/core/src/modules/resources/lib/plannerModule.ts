import * as React from 'react'
import {
  getEnabledModuleIds,
  subscribeToInjectionRegistryChanges,
} from '@open-mercato/shared/modules/widgets/injection-loader'

export const PLANNER_MODULE_ID = 'planner'

export function isPlannerModuleEnabled(): boolean {
  const enabledModuleIds = getEnabledModuleIds()
  return enabledModuleIds === null || enabledModuleIds.has(PLANNER_MODULE_ID)
}

function isPlannerModuleEnabledOnServer(): boolean {
  return true
}

export function usePlannerModuleEnabled(): boolean {
  return React.useSyncExternalStore(
    subscribeToInjectionRegistryChanges,
    isPlannerModuleEnabled,
    isPlannerModuleEnabledOnServer,
  )
}
