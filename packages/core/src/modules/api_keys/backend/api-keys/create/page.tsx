"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import { fetchRoleOptions } from '@open-mercato/core/modules/auth/backend/users/roleOptions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { useRouter } from 'next/navigation'
import { useT } from '@/lib/i18n/context'

type FormValues = {
  name: string
  description: string | null
  organizationId: string | null
  expiresAt: string | null
  roles: string[]
}

export default function CreateApiKeyPage() {
  const [createdSecret, setCreatedSecret] = React.useState<{ secret: string; keyPrefix: string } | null>(null)
  const router = useRouter()
  const t = useT()

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('api_keys.form.name'), type: 'text', required: true },
    { id: 'description', label: t('api_keys.form.description'), type: 'textarea', description: t('api_keys.form.descriptionHint') },
    {
      id: 'organizationId',
      label: t('api_keys.form.organization'),
      required: false,
      type: 'custom',
      component: ({ id, value, setValue }) => (
        <OrganizationSelect
          id={id}
          value={typeof value === 'string' ? value : value ?? null}
          onChange={(next) => setValue(next ?? null)}
          includeEmptyOption
          emptyOptionLabel={t('api_keys.form.organizationPlaceholder')}
          className="w-full h-9 rounded border px-2 text-sm"
        />
      ),
    },
    { id: 'roles', label: t('api_keys.form.roles'), type: 'tags', loadOptions: fetchRoleOptions, description: t('api_keys.form.rolesHint') },
    { id: 'expiresAt', label: t('api_keys.form.expiresAt'), type: 'date', description: t('api_keys.form.expiresHint') },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => ([
    { id: 'details', title: t('api_keys.form.details'), column: 1, fields: ['name', 'description', 'organizationId', 'roles', 'expiresAt'] },
  ]), [t])

  if (createdSecret) {
    return (
      <Page>
        <PageBody>
          <div className="flex items-center justify-center">
            <div className="w-full max-w-2xl rounded-xl border bg-card shadow-sm">
              <div className="border-b p-6">
                <h1 className="text-lg font-semibold leading-7">{t('api_keys.copy.title')}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('api_keys.copy.subtitle')}
                </p>
              </div>
              <div className="space-y-4 p-6">
                <div className="rounded-md border bg-muted/40 p-4 font-mono text-sm break-all">
                  {createdSecret.secret}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center rounded-full border px-2 py-1 font-medium">
                    {t('api_keys.copy.prefix', { prefix: createdSecret.keyPrefix })}
                  </span>
                  <span>{t('api_keys.copy.warning')}</span>
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => router.push('/backend/api-keys')}>
                    {t('common.close')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
      </PageBody>
    </Page>
    )
  }

  return (
    <Page>
      <PageBody className="space-y-6">
        <CrudForm<FormValues>
          title={t('api_keys.form.title')}
          backHref="/backend/api-keys"
          fields={fields}
          groups={groups}
          initialValues={{ name: '', description: null, organizationId: null, roles: [], expiresAt: null }}
          submitLabel={t('common.create')}
          cancelHref="/backend/api-keys"
          onSubmit={async (values) => {
            const payload = {
              name: values.name,
              description: values.description || null,
              organizationId: values.organizationId || null,
              roles: Array.isArray(values.roles) ? values.roles : [],
              expiresAt: values.expiresAt || null,
            }
            const res = await apiFetch('/api/api_keys/keys', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
            if (!res.ok) {
              let message = t('api_keys.form.error.createFailed')
              try {
                const data = await res.clone().json()
                if (data && typeof data.error === 'string') message = data.error
              } catch {}
              throw new Error(message)
            }
            const created = await res.json().catch(() => null)
            if (!created || typeof created.secret !== 'string') {
              throw new Error(t('api_keys.form.error.secretMissing'))
            }
            setCreatedSecret({ secret: created.secret, keyPrefix: created.keyPrefix })
            flash(t('api_keys.form.success'), 'success')
          }}
        />
      </PageBody>
    </Page>
  )
}
