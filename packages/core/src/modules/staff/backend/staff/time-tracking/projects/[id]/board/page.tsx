"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { TaskBoardScreen } from '../../../../../../lib/time-tracking-ui/TaskBoardScreen'
import { NoProjectAccess } from '../../../../../../lib/time-tracking-ui/NoProjectAccess'
import { readItems, readString } from '../../../../../../lib/time-tracking-ui/kanbanBoardData'

const PROJECTS_HREF = '/backend/staff/time-tracking/projects'

type ProjectResult = { id: string; name: string } | { notFound: true } | null

/** The project board of screen 6 — the same screen, with the project already known. */
export default function ProjectBoardPage({ params }: { params?: { id?: string | string[] } }) {
  const t = useT()
  // From the prop, not `useParams()`: backend pages render under the
  // `/backend/[[...slug]]` catch-all, whose params carry `slug`, never `id`.
  const scopeVersion = useOrganizationScopeVersion()
  const rawId = params?.id
  const projectId = Array.isArray(rawId) ? rawId[0] ?? null : rawId ?? null

  const projectKey = projectId ?? 'none'
  const projectQuery = useQuery<ProjectResult>({
    queryKey: ['staff', 'time-tracking', 'board', 'project', `scope:${scopeVersion}`, projectKey],
    enabled: !!projectId,
    staleTime: 60_000,
    // The organization switcher settles the scope just after mount, bumping the
    // scope version from 0 and re-keying this query. Keep the screen resolved
    // before that until the new answer arrives: the loading branch below would
    // unmount it and drop its local state, such as an access request just sent.
    // A switch between two known scopes still goes through the loader.
    placeholderData: (previous, previousQuery) => (
      previousQuery?.queryKey.at(-2) === 'scope:0' && previousQuery.queryKey.at(-1) === projectKey
        ? previous
        : undefined
    ),
    queryFn: async () => {
      if (!projectId) return null
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/time-projects?ids=${encodeURIComponent(projectId)}&pageSize=1`,
      )
      if (!call.ok) {
        if (call.status === 404 && call.result?.reason === 'no_project_access') return null
        if (call.status === 404) return { notFound: true }
        throw new Error(t('staff.timesheets.projects.errors.load', 'Failed to load project.'))
      }
      const row = readItems(call.result)[0]
      if (!row) return { notFound: true }
      const id = readString(row, 'id')
      if (!id) return { notFound: true }
      return { id, name: readString(row, 'name') ?? id }
    },
  })

  if (projectQuery.isLoading) {
    return (
      <Page>
        <PageHeader title={t('staff.time_tracking.nav.tasks', 'Tasks')} />
        <PageBody>
          <LoadingMessage label={t('staff.time_tracking.board.loading', 'Loading the board…')} />
        </PageBody>
      </Page>
    )
  }

  if (projectQuery.isError) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t('staff.timesheets.projects.errors.load', 'Failed to load project.')}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => { void projectQuery.refetch() }}>
                {t('common.retry', 'Retry')}
              </Button>
            }
          />
        </PageBody>
      </Page>
    )
  }

  if (projectId && projectQuery.data === null) {
    return <NoProjectAccess timeProjectId={projectId} />
  }

  if (!projectId || !projectQuery.data || 'notFound' in projectQuery.data) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('staff.timesheets.projects.errors.notFound', 'Project not found.')}
            backHref={PROJECTS_HREF}
            backLabel={t('staff.timesheets.projects.actions.backToList', 'Back to projects')}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <TaskBoardScreen
        timeProjectId={projectId}
        projectName={projectQuery.data.name}
        headerActions={
          <Button asChild variant="outline" size="sm">
            <Link href={`${PROJECTS_HREF}/${projectId}`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('staff.time_tracking.board.backToProject', 'Back to project')}
            </Link>
          </Button>
        }
      />
    </Page>
  )
}
