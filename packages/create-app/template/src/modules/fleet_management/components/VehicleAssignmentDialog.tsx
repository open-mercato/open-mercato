"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type EmployeeOption = {
  id: string
  first_name: string
  last_name: string
  employee_number?: string | null
}

type AssignmentRow = {
  id: string
  vehicle_id: string
  status: 'pending_approval' | 'active' | 'returned' | 'rejected' | 'cancelled'
}

export type VehicleAssignmentDialogProps = {
  vehicleId: string
  handoverOdometer?: number
  isInCustody: boolean
  disabled?: boolean
  onDone?: () => void
}

const FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'
const TEXTAREA_CLASS =
  'min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'
const LABEL_CLASS = 'text-sm font-medium text-foreground'

/**
 * Records custody changes for one vehicle against the assignment command endpoints.
 *
 * Which endpoint applies is derived from the vehicle's own status rather than from a
 * caller flag: a vehicle that is currently `assigned` can only be returned, anything
 * else can only be handed over. The return payload also needs the open assignment id,
 * so it is resolved from the assignments list (the vehicle list does not project it).
 */
export function VehicleAssignmentDialog({
  vehicleId,
  handoverOdometer = 0,
  isInCustody,
  disabled = false,
  onDone,
}: VehicleAssignmentDialogProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [employees, setEmployees] = React.useState<EmployeeOption[]>([])
  const [employeeId, setEmployeeId] = React.useState('')
  const [odometer, setOdometer] = React.useState(String(handoverOdometer))
  const [dueReturnAt, setDueReturnAt] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const mode = isInCustody ? 'return' : 'handover'

  React.useEffect(() => {
    if (!open) return
    setOdometer(String(handoverOdometer))
    setError(null)
    setNotes('')
    setDueReturnAt('')
    setEmployeeId('')
  }, [open, handoverOdometer])

  React.useEffect(() => {
    if (!open || mode !== 'handover') return
    let cancelled = false
    async function load() {
      try {
        const data = await fetchCrudList<EmployeeOption>('hr_management/employees', {
          pageSize: 100,
          status: 'active',
          sortField: 'lastName',
          sortDir: 'asc',
        })
        if (!cancelled) setEmployees(data?.items ?? [])
      } catch {
        if (!cancelled) setEmployees([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [open, mode])

  const close = React.useCallback(() => {
    if (!pending) setOpen(false)
  }, [pending])

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const headers = { 'content-type': 'application/json' }
      if (mode === 'handover') {
        await apiCallOrThrow('/api/fleet_management/assignments/handover', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            vehicleId,
            employeeId,
            handoverOdometer: Number(odometer),
            ...(dueReturnAt ? { dueReturnAt: new Date(dueReturnAt).toISOString() } : {}),
            ...(notes.trim().length > 0 ? { custodyNotes: notes.trim() } : {}),
          }),
        })
      } else {
        const openAssignments = await fetchCrudList<AssignmentRow>('fleet_management/assignments', {
          vehicleId,
          status: 'active',
          pageSize: 1,
        })
        const assignment = openAssignments?.items?.[0]
        if (!assignment) {
          throw new Error(t('fleet_management.assignments.errors.noOpenCustody', 'This vehicle has no open custody record.'))
        }
        await apiCallOrThrow('/api/fleet_management/assignments/return', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            id: assignment.id,
            returnOdometer: Number(odometer),
            ...(notes.trim().length > 0 ? { custodyNotes: notes.trim() } : {}),
          }),

        })
      }
      setOpen(false)
      onDone?.()
    } catch (caught: unknown) {
      setError(caught instanceof Error && caught.message ? caught.message : t('fleet_management.assignments.errors.failed', 'The operation could not be completed.'))
    } finally {
      setPending(false)
    }
  }

  const submitDisabled = pending || odometer.trim().length === 0 || (mode === 'handover' && employeeId.length === 0)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setOpen(true); else close() }}>
      <DialogTrigger asChild>
        <Button type="button" variant={mode === 'return' ? 'outline' : 'default'} size="sm" disabled={disabled}>
          {mode === 'return'
            ? t('fleet_management.vehicles.actions.return', 'Return')
            : t('fleet_management.vehicles.actions.handover', 'Hand over')}
        </Button>
      </DialogTrigger>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !submitDisabled) {
            event.preventDefault()
            void submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === 'return'
              ? t('fleet_management.assignments.return.title', 'Return vehicle')
              : t('fleet_management.assignments.handover.title', 'Hand over vehicle')}
          </DialogTitle>
          <DialogDescription>
            {t('fleet_management.assignments.description', 'The vehicle status and its odometer history follow the custody record.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {mode === 'handover' ? (
            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>{t('fleet_management.assignments.fields.employee', 'Employee')}</span>
              <select
                className={FIELD_CLASS}
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
              >
                <option value="">{t('fleet_management.assignments.fields.employeePlaceholder', 'Select an employee')}</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {`${employee.first_name} ${employee.last_name}${employee.employee_number ? ` (${employee.employee_number})` : ''}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>{t('fleet_management.assignments.fields.odometer', 'Odometer reading (km)')}</span>
            <input
              className={FIELD_CLASS}
              type="number"
              min={0}
              value={odometer}
              onChange={(event) => setOdometer(event.target.value)}
            />
          </label>

          {mode === 'handover' ? (
            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>{t('fleet_management.assignments.fields.dueReturnAt', 'Due return date')}</span>
              <input
                className={FIELD_CLASS}
                type="date"
                value={dueReturnAt}
                onChange={(event) => setDueReturnAt(event.target.value)}
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>{t('fleet_management.assignments.fields.custodyNotes', 'Custody notes')}</span>
            <textarea
              className={TEXTAREA_CLASS}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>

          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant={mode === 'return' ? 'outline' : 'default'}
            disabled={submitDisabled}
            onClick={() => { void submit() }}
          >
            {mode === 'return'
              ? t('fleet_management.assignments.return.submit', 'Record return')
              : t('fleet_management.assignments.handover.submit', 'Record handover')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
