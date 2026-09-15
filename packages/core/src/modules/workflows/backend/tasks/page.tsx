"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { WORK_INBOX_HREF } from '../../lib/work-inbox/navigation'

/**
 * Bridge route — the User Tasks list is REPLACED by the Work Inbox (spec §6.2:
 * "`backend/tasks` redirects to the Work Inbox; instance URLs preserved").
 *
 * Same shape as the Phase-3b form-editor bridges: the file stays for at least
 * one minor release so bookmarks and third-party navigation keep working, and
 * its sibling `page.meta.ts` keeps enforcing the RBAC guard it always did (it
 * only gains `navHidden`, so the sidebar shows one inbox entry rather than two).
 * Task DETAIL urls are untouched — `/backend/tasks/<id>` still resolves.
 *
 * @deprecated Link to `/backend/work-inbox` instead.
 */
export default function UserTasksListPage() {
  const router = useRouter()
  const t = useT()

  React.useEffect(() => {
    router.replace(WORK_INBOX_HREF)
  }, [router])

  return (
    <Page>
      <PageBody>
        <LoadingMessage label={t('workflows.redirect.toWorkInbox', 'Opening the work inbox…')} />
      </PageBody>
    </Page>
  )
}
