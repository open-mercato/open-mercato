import * as React from 'react'
import type { ScheduleActivityEditData } from '../../../../../components/detail/ScheduleActivityDialog'

type UseScheduleDialogResult = {
  scheduleDialogOpen: boolean
  scheduleEditData: ScheduleActivityEditData | null
  openSchedule: () => void
  openEdit: (data: ScheduleActivityEditData) => void
  closeSchedule: () => void
}

export function useScheduleDialog(): UseScheduleDialogResult {
  const [scheduleDialogOpen, setScheduleDialogOpen] = React.useState(false)
  const [scheduleEditData, setScheduleEditData] = React.useState<ScheduleActivityEditData | null>(null)

  const openSchedule = React.useCallback(() => {
    setScheduleEditData(null)
    setScheduleDialogOpen(true)
  }, [])

  const openEdit = React.useCallback((data: ScheduleActivityEditData) => {
    setScheduleEditData(data)
    setScheduleDialogOpen(true)
  }, [])

  const closeSchedule = React.useCallback(() => {
    setScheduleDialogOpen(false)
    setScheduleEditData(null)
  }, [])

  return {
    scheduleDialogOpen,
    scheduleEditData,
    openSchedule,
    openEdit,
    closeSchedule,
  }
}
