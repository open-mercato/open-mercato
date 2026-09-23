"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { TaskBoardScreen } from '../../../../../../lib/time-tracking-ui/TaskBoardScreen'
import { NoProjectAccess } from '../../../../../../lib/time-tracking-ui/NoProjectAccess'
import { readItems, readString } from '../../../../../../lib/time-tracking-ui/kanbanBoardData'

const PROJECTS_HREF = '/backend/staff/time-tracking/projects'

/** The project board of screen 6 — the same screen, with the project already known. */
export default function ProjectBoardPage({ params }: { params?: { id?: string | string[] } }) {
  const t = useT()
  // From the prop, not `useParams()`: backend pages render under the
  // `/backend/[[...slug]]` catch-all, whose params carry `slug`, never `id`.
  const scopeVersion = useOrganizationScopeVersion()
  const rawId = params?.id
  const projectId = Array.isArray(rawId) ? rawId[0] ?? null : rawId ?? null

  const projectQuery = useQuery<{ id: string; name: string } | null>({
    queryKey: ['staff', 'time-tracking', 'board', 'project', `scope:${scopeVersion}`, projectId ?? 'none'],
    enabled: !!projectId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!projectId) return null
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/time-projects?ids=${encodeURIComponent(projectId)}&pageSize=1`,
      )
      if (!call.ok) return null
      const row = readItems(call.result)[0]
      if (!row) return null
      const id = readString(row, 'id')
      if (!id) return null
      return { id, name: readString(row, 'name') ?? id }
    },
  })

  if (!projectId) {
    return <NoProjectAccess />
  }

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

  if (!projectQuery.data) {
    return <NoProjectAccess timeProjectId={projectId} />
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
