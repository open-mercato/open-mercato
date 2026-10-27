'use client'

// Create page for a `Code` (Release 4 PLAN.md Step 6.6, SPEC-055 "Promotional Codes
// (`/backend/codes`)"). Mirrors `promotions/backend/promotions/create/page.tsx`'s shape
// (shared field/schema/groups helper + `CrudForm` + `createCrud`) — `codeFormFields.tsx`
// is this entity's equivalent of `promotionFormFields.tsx`.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  createCodeFormFields,
  createCodeFormGroups,
  createCodeFormSchema,
  type CodeFormValues,
} from '../../../components/codeFormFields'

export default function CreateCodePage() {
  const t = useT()
  const router = useRouter()

  const schema = React.useMemo(() => createCodeFormSchema(t), [t])
  const fields = React.useMemo(() => createCodeFormFields(t), [t])
  const groups = React.useMemo(() => createCodeFormGroups(t), [t])
  const initialValues = React.useMemo<Partial<CodeFormValues>>(
    () => ({
      type: 'static',
      usage: 'single',
      active: true,
    }),
    [],
  )

  return (
    <Page>
      <PageBody>
        <CrudForm<CodeFormValues>
          title={t('promotions.codes.form.title.create', 'Create promotional code')}
          titleHeadingLevel={1}
          backHref="/backend/codes"
          cancelHref="/backend/codes"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          schema={schema}
          submitLabel={t('promotions.codes.form.submit', 'Save code')}
          onSubmit={async (values) => {
            const isStatic = values.type === 'static'
            const payload = {
              name: values.name,
              type: values.type,
              code: isStatic ? values.code ?? null : null,
              prefix: isStatic ? null : values.prefix ?? null,
              suffix: isStatic ? null : values.suffix ?? null,
              length: isStatic ? null : values.length ?? null,
              amount: isStatic ? null : values.amount ?? null,
              usage: values.usage,
              usageAmount: values.usage === 'multiple' ? values.usageAmount ?? null : null,
              usagePerCustomer: values.usagePerCustomer ?? null,
              active: values.active,
            }

            const { result } = await createCrud<{ id: string | null }>('promotions/codes', payload)
            flash(t('promotions.codes.form.success.create', 'Promotional code created'), 'success')
            if (result?.id) router.push(`/backend/codes/${result.id}`)
            else router.push('/backend/codes')
          }}
        />
      </PageBody>
    </Page>
  )
}
