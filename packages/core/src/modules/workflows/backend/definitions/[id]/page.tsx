"use client"

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
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
export default function EditWorkflowDefinitionPage() {
  const router = useRouter()
  const params = useParams()
  const t = useT()

  // The catch-all backend router can deliver the id either as `params.id` or as
  // the second segment of `params.slug` (`['definitions', '<uuid>']`).
  let definitionId: string | undefined
  if (params?.slug && Array.isArray(params.slug)) {
    definitionId = params.slug[1]
  } else if (params?.id) {
    definitionId = Array.isArray(params.id) ? params.id[0] : params.id
  }

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
