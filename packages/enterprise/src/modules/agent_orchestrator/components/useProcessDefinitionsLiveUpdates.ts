'use client'

import { useEffect, useRef } from 'react'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useCoalescedReload } from './useCoalescedReload'

const RECONNECT_CATCH_UP_MS = 5000

export function useProcessDefinitionsLiveUpdates(reload: () => void): void {
  const coalescedReload = useCoalescedReload(reload)
  const catchUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (catchUpTimer.current) clearTimeout(catchUpTimer.current)
  }, [])

  useAppEvent('agent_orchestrator.process.execution.*', coalescedReload)
  useAppEvent('om:bridge:reconnected', () => {
    coalescedReload()
    if (catchUpTimer.current) clearTimeout(catchUpTimer.current)
    catchUpTimer.current = setTimeout(() => {
      catchUpTimer.current = null
      coalescedReload()
    }, RECONNECT_CATCH_UP_MS)
  })
}
