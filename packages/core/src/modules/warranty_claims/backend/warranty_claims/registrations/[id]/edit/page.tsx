"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  buildRegistrationPayload,
  normalizeRegistration,
  useRegistrationFormConfig,
  type RegistrationFormValues,
  type RegistrationRecord,
} from '../../registrationForm'

export default function EditWarrantyClaimRegistrationPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : ''
  const [registration, setRegistration] = React.useState<RegistrationRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const { fields, groups } = useRegistrationFormConfig(t, registration)

  React.useEffect(() => {
    let cancelled = false
    async function loadRegistration() {
      setLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<{ items?: unknown[] }>(
          `/api/warranty_claims/registrations?ids=${encodeURIComponent(id)}&page=1&pageSize=1`,
          undefined,
          {
            fallback: { items: [] },
            errorMessage: t('warranty_claims.registrations.edit.error.load', 'Failed to load warranty registration.'),
          },
        )
        if (cancelled) return
        const item = (payload.items ?? [])
          .map(normalizeRegistration)
          .find((entry): entry is RegistrationRecord => entry !== null) ?? null
        if (!item) {
          setRegistration(null)
          setError(t('warranty_claims.registrations.edit.notFound', 'Warranty registration not found.'))
          return
        }
        setRegistration(item)
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t('warranty_claims.registrations.edit.error.load', 'Failed to load warranty registration.'),
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (id) void loadRegistration()
    return () => {
      cancelled = true
    }
  }, [id, t])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('warranty_claims.registrations.edit.loading', 'Loading warranty registration...')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !registration) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('warranty_claims.registrations.edit.notFound', 'Warranty registration not found.')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<RegistrationFormValues>
          title={t('warranty_claims.registrations.edit.title', 'Edit warranty registration')}
          backHref="/backend/warranty_claims/registrations"
          fields={fields}
          groups={groups}
          initialValues={{ ...registration }}
          submitLabel={t('warranty_claims.registrations.form.submit.update', 'Save registration')}
          cancelHref="/backend/warranty_claims/registrations"
          entityId="warranty_claims:warranty_claim_registration"
          onSubmit={async (values) => {
            await updateCrud('warranty_claims/registrations', buildRegistrationPayload(values, registration.id), {
              errorMessage: t('warranty_claims.registrations.edit.error.save', 'Failed to save warranty registration.'),
            })
            flash(t('warranty_claims.registrations.edit.success', 'Warranty registration saved.'), 'success')
            router.push('/backend/warranty_claims/registrations')
          }}
          onDelete={async () => {
            await deleteCrud('warranty_claims/registrations', registration.id, {
              errorMessage: t('warranty_claims.registrations.edit.error.delete', 'Failed to delete warranty registration.'),
            })
            flash(t('warranty_claims.registrations.edit.deleted', 'Warranty registration deleted.'), 'success')
            router.push('/backend/warranty_claims/registrations')
          }}
        />
      </PageBody>
    </Page>
  )
}
