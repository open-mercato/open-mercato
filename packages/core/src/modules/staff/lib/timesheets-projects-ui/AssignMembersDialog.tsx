"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff')

const SEARCH_DEBOUNCE_MS = 300
const CANDIDATE_PAGE_SIZE = 50

export type AssignMembersSubmitInput = {
  staffMemberIds: string[]
  role: string | null
  assignedStartDate: string
}

export type AssignMembersDialogLabels = {
  title: string
  description: string
  searchPlaceholder: string
  empty: string
  loadError: string
  loading: string
  role: string
  rolePlaceholder: string
  startDate: string
  cancel: string
  confirm: string
}

export type AssignMembersDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  labels: AssignMembersDialogLabels
  isSaving: boolean
  onConfirm: (input: AssignMembersSubmitInput) => void
}

type StaffMemberItem = {
  id?: unknown
  display_name?: unknown
  displayName?: unknown
  team?: { name?: unknown } | null
}

type StaffMembersResponse = { items?: StaffMemberItem[] }

type Candidate = { id: string; name: string; subtitle: string | null }

function toCandidate(item: StaffMemberItem): Candidate | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const displayName =
    typeof item.display_name === 'string'
      ? item.display_name
      : typeof item.displayName === 'string'
        ? item.displayName
        : id
  const teamName = typeof item.team?.name === 'string' ? item.team.name : null
  return { id, name: displayName, subtitle: teamName }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function AssignMembersDialog({
  open,
  onOpenChange,
  labels,
  isSaving,
  onConfirm,
}: AssignMembersDialogProps) {
  const [search, setSearch] = React.useState('')
  const [candidates, setCandidates] = React.useState<Candidate[]>([])
  // The candidate list is fetched behind a debounce, so the dialog would render
  // its "no results" copy for the whole debounce window before the first request
  // even leaves. Seed the loading state from `open` instead.
  const [isLoading, setIsLoading] = React.useState(open)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [role, setRole] = React.useState('')
  const [startDate, setStartDate] = React.useState(todayIso)

  React.useEffect(() => {
    if (!open) return
    setSearch('')
    setSelectedIds([])
    setRole('')
    setStartDate(todayIso())
    setLoadError(null)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setIsLoading(true)
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({
        pageSize: String(CANDIDATE_PAGE_SIZE),
        isActive: 'true',
      })
      if (search.trim()) params.set('search', search.trim())
      readApiResultOrThrow<StaffMembersResponse>(
        `/api/staff/team-members?${params.toString()}`,
        undefined,
        { errorMessage: labels.loadError, fallback: { items: [] } },
      )
        .then((payload) => {
          if (cancelled) return
          const items = Array.isArray(payload.items) ? payload.items : []
          setCandidates(items.map(toCandidate).filter((item): item is Candidate => item !== null))
          setLoadError(null)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          logger.error('staff.timesheets.projects.assignMembers.candidates', { err: error })
          setCandidates([])
          setLoadError(labels.loadError)
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [open, search, labels.loadError])

  const toggleCandidate = React.useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((value) => value !== id)))
  }, [])

  const canSubmit = selectedIds.length > 0 && startDate.length > 0 && !isSaving

  const submit = React.useCallback(() => {
    if (selectedIds.length === 0 || !startDate) return
    onConfirm({ staffMemberIds: selectedIds, role: role.trim() || null, assignedStartDate: startDate })
  }, [onConfirm, role, selectedIds, startDate])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        if (canSubmit) submit()
      }
    },
    [canSubmit, submit],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">{labels.description}</p>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={labels.searchPlaceholder}
            aria-label={labels.searchPlaceholder}
          />
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1">
            {isLoading ? (
              <LoadingMessage label={labels.loading} />
            ) : loadError ? (
              <ErrorMessage label={loadError} />
            ) : candidates.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">{labels.empty}</p>
            ) : (
              candidates.map((candidate) => (
                <label
                  key={candidate.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedIds.includes(candidate.id)}
                    onCheckedChange={(checked) => toggleCandidate(candidate.id, Boolean(checked))}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-foreground">{candidate.name}</span>
                    {candidate.subtitle ? (
                      <span className="truncate text-xs text-muted-foreground">{candidate.subtitle}</span>
                    ) : null}
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="assign-members-role">
              {labels.role}
            </label>
            <Input
              id="assign-members-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder={labels.rolePlaceholder}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="assign-members-start-date">
              {labels.startDate}
            </label>
            <Input
              id="assign-members-start-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={submit}>
              {isSaving ? <Spinner className="size-4" /> : null}
              {labels.confirm}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default AssignMembersDialog
