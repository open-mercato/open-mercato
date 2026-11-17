"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const createSchema = z.object({
  key: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z][a-z0-9_-]*$/, 'forms.errors.invalid_key'),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  defaultLocale: z.string().min(2).max(10),
  supportedLocales: z.string().min(2),
})

type CreateValues = z.infer<typeof createSchema>

export default function CreateFormPage() {
  const t = useT()
  const router = useRouter()

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'key',
      label: t('forms.create.fields.key'),
      type: 'text',
      required: true,
      description: t('forms.create.fields.keyHelp'),
      placeholder: 'patient-intake',
      maxLength: 64,
    },
    {
      id: 'name',
      label: t('forms.create.fields.name'),
      type: 'text',
      required: true,
      maxLength: 200,
    },
    {
      id: 'description',
      label: t('forms.create.fields.description'),
      type: 'textarea',
      maxLength: 2000,
      rows: 3,
    },
    {
      id: 'defaultLocale',
      label: t('forms.create.fields.defaultLocale'),
      type: 'text',
      required: true,
      defaultValue: 'en',
      placeholder: 'en',
    },
    {
      id: 'supportedLocales',
      label: t('forms.create.fields.supportedLocales'),
      type: 'text',
      required: true,
      defaultValue: 'en',
      description: 'Comma-separated locale tags (e.g. "en, pl").',
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('forms.create.title')}
          backHref="/backend/forms"
          cancelHref="/backend/forms"
          fields={fields}
          schema={createSchema}
          submitLabel={t('forms.create.actions.submit')}
          initialValues={{ defaultLocale: 'en', supportedLocales: 'en' }}
          onSubmit={async (raw) => {
            const values = raw as CreateValues
            const supported = values.supportedLocales
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean)
            const payload = {
              key: values.key.trim(),
              name: values.name.trim(),
              description: values.description?.trim() || null,
              defaultLocale: values.defaultLocale.trim(),
              supportedLocales: supported.length ? supported : [values.defaultLocale.trim()],
            }
            const result = await createCrud<{ id?: string | null }>('forms', payload)
            if (!result.ok) {
              const err = (result.result as { error?: string } | undefined)?.error
              throw new Error(err ?? 'forms.errors.internal')
            }
            const created = result.result
            if (created?.id) {
              flash(t('forms.create.actions.submit'), 'success')
              router.push(`/backend/forms/${encodeURIComponent(created.id)}`)
            } else {
              router.push('/backend/forms')
            }
          }}
        />
      </PageBody>
    </Page>
  )
}
