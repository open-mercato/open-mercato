"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { TaskBoardScreen } from '../../../../lib/time-tracking-ui/TaskBoardScreen'
import { readItems, readString } from '../../../../lib/time-tracking-ui/kanbanBoardData'

type BoardProject = {
  id: string
  name: string
}

/**
 * The module-level Tasks board (screen 6).
 *
 * Columns are per project (D-1), so the board always needs one. This route carries the
 * project in `?projectId=` and falls back to the first project the caller can see; the
 * per-project route renders the same screen with the id already resolved.
 */
export default function TimeTrackingBoardPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const requestedProjectId = searchParams?.get('projectId') ?? null

  const projectsQuery = useQuery<BoardProject[]>({
    queryKey: ['staff', 'time-tracking', 'board', 'projects', `scope:${scopeVersion}`],
    staleTime: 60_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        '/api/staff/timesheets/time-projects?page=1&pageSize=100&sortField=name&sortDir=asc',
      )
      // A failed call must not look like an empty project list: the empty state below
      // tells the caller to ask a Team Leader for access, which is the wrong advice for
      // a network error or a 500.
      if (!call.ok) throw new Error(`[internal] staff.time_tracking board projects request failed (${call.status})`)
      return readItems(call.result)
        .map((row) => {
          const id = readString(row, 'id')
          if (!id) return null
          return { id, name: readString(row, 'name') ?? id }
        })
        .filter((project): project is BoardProject => project !== null)
    },
  })

  const projects = projectsQuery.data ?? []
  const activeProject =
    projects.find((project) => project.id === requestedProjectId) ?? projects[0] ?? null

  const handleProjectChange = React.useCallback(
    (projectId: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('projectId', projectId)
      params.delete('task')
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const projectPicker =
    projects.length > 0 && activeProject ? (
      <Select value={activeProject.id} onValueChange={handleProjectChange}>
        <SelectTrigger
          className="w-64"
          aria-label={t('staff.time_tracking.board.projectPicker', 'Project')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null

  if (projectsQuery.isLoading) {
    return (
      <Page>
        <PageHeader title={t('staff.time_tracking.nav.tasks', 'Tasks')} />
        <PageBody>
          <LoadingMessage label={t('staff.time_tracking.board.loading', 'Loading the board…')} />
        </PageBody>
      </Page>
    )
  }

  if (projectsQuery.isError) {
    return (
      <Page>
        <PageHeader title={t('staff.time_tracking.nav.tasks', 'Tasks')} />
        <PageBody>
          <ErrorMessage
            label={t('staff.time_tracking.board.projectsLoadError', 'Could not load your projects.')}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => void projectsQuery.refetch()}>
                {t('staff.time_tracking.board.reload', 'Try again')}
              </Button>
            }
          />
        </PageBody>
      </Page>
    )
  }

  if (!activeProject) {
    return (
      <Page>
        <PageHeader title={t('staff.time_tracking.nav.tasks', 'Tasks')} />
        <PageBody>
          <EmptyState
            title={t('staff.time_tracking.board.noProject.title', 'No project to show')}
            description={t(
              'staff.time_tracking.board.noProject.description',
              'The board needs a project. Ask a Team Leader for access to one.',
            )}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <TaskBoardScreen
        timeProjectId={activeProject.id}
        projectName={activeProject.name}
        headerActions={projectPicker}
      />
    </Page>
  )
}
