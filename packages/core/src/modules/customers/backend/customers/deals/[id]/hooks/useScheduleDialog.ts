import * as React from 'react'
import type { ScheduleActivityEditData } from '../../../../../components/detail/ScheduleActivityDialog'
import { resolveActivityStartOnDay } from '../../../../../components/detail/schedule/useScheduleFormState'

type UseScheduleDialogResult = {
  scheduleDialogOpen: boolean
  scheduleEditData: ScheduleActivityEditData | null
  openSchedule: (selectedDate?: Date) => void
  openEdit: (data: ScheduleActivityEditData) => void
  closeSchedule: () => void
}

export function useScheduleDialog(): UseScheduleDialogResult {
  const [scheduleDialogOpen, setScheduleDialogOpen] = React.useState(false)
  const [scheduleEditData, setScheduleEditData] = React.useState<ScheduleActivityEditData | null>(null)

  const openSchedule = React.useCallback((selectedDate?: Date) => {
    setScheduleEditData(selectedDate ? {
      id: '',
      scheduledAt: resolveActivityStartOnDay('meeting', selectedDate).toISOString(),
    } : null)
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
