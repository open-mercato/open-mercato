"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { WORKFLOW_STUDIO_CREATE_HREF } from '../../../lib/visual-editor-navigation'

/**
 * Bridge route — the form editor is RETIRED (spec section 10).
 *
 * The Studio (`/backend/definitions/visual-editor`) is the only workflow editor;
 * this file stays for at least one minor release so bookmarks, deep links and
 * third-party navigation to `/backend/definitions/create` keep working, and its
 * sibling `page.meta.ts` keeps enforcing the same RBAC guard it always did. It
 * is deliberately NOT deleted — see BACKWARD_COMPATIBILITY.md's deprecation
 * protocol and the UPGRADE_NOTES entry.
 *
 * @deprecated Link to `/backend/definitions/visual-editor` instead.
 */
export default function CreateWorkflowDefinitionPage() {
  const router = useRouter()
  const t = useT()

  React.useEffect(() => {
    router.replace(WORKFLOW_STUDIO_CREATE_HREF)
  }, [router])

  return (
    <Page>
      <PageBody>
        <LoadingMessage label={t('workflows.redirect.toStudio', 'Opening the workflow studio…')} />
      </PageBody>
    </Page>
  )
}
