"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildVisualEditorHref, WORKFLOW_STUDIO_CREATE_HREF } from '../../../lib/visual-editor-navigation'

/**
 * Bridge route — the form editor is RETIRED (spec section 10).
 *
 * Every definition is now edited in the Studio, so this route forwards to
 * `/backend/definitions/visual-editor?id=<id>` and keeps its sibling
 * `page.meta.ts` guard intact. It stays for at least one minor release for
 * bookmarks and third-party deep links, per BACKWARD_COMPATIBILITY.md's
 * deprecation protocol, and is deliberately NOT deleted.
 *
 * @deprecated Link to `/backend/definitions/visual-editor?id=<id>` instead.
 */
export default function EditWorkflowDefinitionPage({ params }: { params?: { id?: string } }) {
  const router = useRouter()
  const t = useT()
  // The id comes from the params prop the /backend/[...slug] catch-all passes
  // down, never from the router hook or a positional slug index (#5600).
  const definitionId = params?.id

  React.useEffect(() => {
    router.replace(definitionId ? buildVisualEditorHref(definitionId) : WORKFLOW_STUDIO_CREATE_HREF)
  }, [router, definitionId])

  return (
    <Page>
      <PageBody>
        <LoadingMessage label={t('workflows.redirect.toStudio', 'Opening the workflow studio…')} />
      </PageBody>
    </Page>
  )
}
