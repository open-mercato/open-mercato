"use client"

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Label } from '@open-mercato/ui/primitives/label'
import { readRowItems, toProjectOption, type ProjectOption } from './timeEntryDialogState'

const PROJECT_SEARCH_PAGE_SIZE = 50

/** The project field's search: active projects the caller may log to, by name. */
async function fetchProjectOptions(term: string): Promise<ProjectOption[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(PROJECT_SEARCH_PAGE_SIZE),
    sortField: 'name',
    sortDir: 'asc',
    status: 'active',
  })
  if (term) params.set('q', term)
  const call = await apiCall<Record<string, unknown>>(`/api/staff/timesheets/time-projects?${params.toString()}`)
  if (!call.ok) return []
  return readRowItems(call.result)
    .map(toProjectOption)
    .filter((project): project is ProjectOption => project !== null)
}

/**
 * Resolves one project by id. The route answers 404 for a project the caller
 * cannot see, which here simply means "unresolved" — never an error to flash.
 */
async function fetchProjectById(id: string): Promise<ProjectOption | null> {
  const call = await apiCall<Record<string, unknown>>(
    `/api/staff/timesheets/time-projects?ids=${encodeURIComponent(id)}&pageSize=1`,
  ).catch(() => null)
  if (!call?.ok) return null
  const row = readRowItems(call.result)[0]
  return row ? toProjectOption(row) : null
}

function toComboboxOption(project: ProjectOption): ComboboxOption {
  return { value: project.id, label: project.name, description: project.customerName }
}

export type TimeEntryProjectFieldProps = {
  /** The selected project id, or null while none is picked. */
  value: string | null
  onChange: (next: string) => void
  /** Projects the dialog already holds (its first directory page plus earlier lookups). */
  knownProjects: ReadonlyMap<string, ProjectOption>
  /** True while the dialog's first directory page is still loading. */
  knownProjectsPending: boolean
  /** Every project found by a search or a pin lookup, so the dialog can price it. */
  onProjectsResolved: (found: ProjectOption[]) => void
  /** React-query key prefix for the by-id lookup; the dialog keys it on its organization scope. */
  queryKeyPrefix: readonly unknown[]
  error: string | null
  disabled: boolean
  triggerRef: React.Ref<HTMLDivElement>
}

/**
 * The project-mode project field of `TimeEntryDialog`: an access-scoped typeahead
 * over active projects, with a by-id lookup for a selected project that is not on
 * the dialog's first directory page. A project the caller cannot see (the lookup
 * answers 404) shows a fallback label instead of an error.
 */
export function TimeEntryProjectField({
  value,
  onChange,
  knownProjects,
  knownProjectsPending,
  onProjectsResolved,
  queryKeyPrefix,
  error,
  disabled,
  triggerRef,
}: TimeEntryProjectFieldProps): React.ReactElement {
  const t = useT()
  const queryClient = useQueryClient()
  const unavailableLabel = t('staff.time_tracking.entryDialog.projectUnavailable', 'Project not available')

  const loadSuggestions = React.useCallback(
    async (query?: string): Promise<ComboboxOption[]> => {
      const found = await fetchProjectOptions((query ?? '').trim())
      onProjectsResolved(found)
      return found.map(toComboboxOption)
    },
    [onProjectsResolved],
  )

  const loadPinnedProject = React.useCallback(
    async (id: string): Promise<ProjectOption | null> => {
      const found = await fetchProjectById(id)
      if (found) onProjectsResolved([found])
      return found
    },
    [onProjectsResolved],
  )

  const resolveLabel = React.useCallback(
    async (id: string): Promise<string> => {
      const known = knownProjects.get(id)
      if (known) return known.name
      const found = await queryClient.fetchQuery({
        queryKey: [...queryKeyPrefix, id],
        queryFn: () => loadPinnedProject(id),
        staleTime: 60_000,
      })
      return found ? found.name : unavailableLabel
    },
    [knownProjects, loadPinnedProject, queryClient, queryKeyPrefix, unavailableLabel],
  )

  const unresolvedId = value && !knownProjectsPending && !knownProjects.has(value) ? value : null

  const pinnedProjectQuery = useQuery<ProjectOption | null>({
    queryKey: [...queryKeyPrefix, unresolvedId ?? 'none'],
    enabled: !!unresolvedId,
    staleTime: 60_000,
    queryFn: () => loadPinnedProject(unresolvedId as string),
  })

  const seedOptions = React.useMemo<ComboboxOption[]>(() => {
    if (!value) return []
    const known = knownProjects.get(value)
    if (known) return [toComboboxOption(known)]
    if (pinnedProjectQuery.isSuccess && pinnedProjectQuery.data === null) {
      return [{ value, label: unavailableLabel, description: null }]
    }
    return []
  }, [knownProjects, pinnedProjectQuery.data, pinnedProjectQuery.isSuccess, unavailableLabel, value])

  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {t('staff.time_tracking.entryDialog.project', 'Project')}
        <span aria-hidden="true"> *</span>
      </Label>
      <div
        data-testid="entry-dialog-project"
        ref={triggerRef}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'entry-dialog-project-message' : undefined}
      >
        <ComboboxInput
          value={value ?? ''}
          onChange={onChange}
          placeholder={t('staff.time_tracking.entryDialog.projectPlaceholder', 'Search projects')}
          seedOptions={seedOptions}
          loadSuggestions={loadSuggestions}
          resolveLabel={resolveLabel}
          resolveDescription={(id) => knownProjects.get(id)?.customerName ?? null}
          allowCustomValues={false}
          disabled={disabled}
        />
      </div>
      {error ? (
        <p
          id="entry-dialog-project-message"
          className="text-xs text-status-error-text"
          role="alert"
          data-testid="entry-dialog-project-error"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
