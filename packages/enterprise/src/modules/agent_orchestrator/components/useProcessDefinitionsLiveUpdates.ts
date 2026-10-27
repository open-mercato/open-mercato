'use client'

import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useCoalescedReload } from './useCoalescedReload'

export function useProcessDefinitionsLiveUpdates(reload: () => void): void {
  const coalescedReload = useCoalescedReload(reload)
  useAppEvent('agent_orchestrator.process.execution.*', coalescedReload)
  useAppEvent('om:bridge:reconnected', coalescedReload)
}
