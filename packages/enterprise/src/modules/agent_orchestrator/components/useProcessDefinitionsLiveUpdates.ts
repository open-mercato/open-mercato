'use client'

import { useEffect, useRef } from 'react'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useCoalescedReload } from './useCoalescedReload'

const RELOAD_INTERVAL_MS = 5000

export function useProcessDefinitionsLiveUpdates(reload: () => void): void {
  const coalescedReload = useCoalescedReload(reload, { minIntervalMs: RELOAD_INTERVAL_MS })
  const catchUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (catchUpTimer.current) clearTimeout(catchUpTimer.current)
  }, [])

  useAppEvent('agent_orchestrator.process.execution.*', () => {
    coalescedReload()
  })
  useAppEvent('om:bridge:reconnected', () => {
    coalescedReload()
    if (catchUpTimer.current) clearTimeout(catchUpTimer.current)
    catchUpTimer.current = setTimeout(() => {
      catchUpTimer.current = null
      coalescedReload()
    }, RELOAD_INTERVAL_MS)
  })
}
