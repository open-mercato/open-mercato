/**
 * Create page template (lineage: om-ds-guardian page-templates.md §Create Page +
 * packages/core/src/modules/customers/backend/customers/people/create/page.tsx).
 */
export const createPageTemplate = `"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  {{entityUpperSnake}}_ENTITY_ID,
  create{{entityPascal}}FormFields,
  create{{entityPascal}}FormGroups,
  create{{entityPascal}}FormSchema,
  type {{entityPascal}}FormValues,
} from '../../../components/formConfig'

export default function {{entityPascal}}CreatePage() {
  const t = useT()
  const router = useRouter()
  const schema = React.useMemo(() => create{{entityPascal}}FormSchema(), [])
  const fields = React.useMemo(() => create{{entityPascal}}FormFields(t), [t])
  const groups = React.useMemo(() => create{{entityPascal}}FormGroups(t), [t])

  return (
    <Page>
      <PageBody>
        <CrudForm<{{entityPascal}}FormValues>
          title={t('{{moduleId}}.create.title', 'Create {{entityLower}}')}
          backHref="/backend/{{moduleId}}"
          cancelHref="/backend/{{moduleId}}"
          schema={schema}
          fields={fields}
          groups={groups}
          entityIds={[{{entityUpperSnake}}_ENTITY_ID]}
          submitLabel={t('{{moduleId}}.form.submit', 'Save')}
          onSubmit={async (values) => {
            const call = await createCrud<{ id?: string }>('{{moduleId}}', values)
            const createdId = typeof call.result?.id === 'string' ? call.result.id : null
            flash(t('{{moduleId}}.create.success', '{{entityTitle}} created'), 'success')
            router.push(createdId ? '/backend/{{moduleId}}/' + createdId : '/backend/{{moduleId}}')
          }}
        />
      </PageBody>
    </Page>
  )
}
`
