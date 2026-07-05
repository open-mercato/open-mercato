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
  buildTroubleshootingGuidePayload,
  normalizeTroubleshootingGuide,
  toTroubleshootingGuideInitialValues,
  useTroubleshootingGuideFormConfig,
  type TroubleshootingGuideFormValues,
  type TroubleshootingGuideRecord,
} from '../../troubleshootingGuideForm'

export default function EditWarrantyTroubleshootingGuidePage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : ''
  const [guide, setGuide] = React.useState<TroubleshootingGuideRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const { fields, groups } = useTroubleshootingGuideFormConfig(t)

  React.useEffect(() => {
    let cancelled = false
    async function loadGuide() {
      setLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<{ items?: unknown[] }>(
          `/api/warranty_claims/troubleshooting-guides?ids=${encodeURIComponent(id)}&page=1&pageSize=1`,
          undefined,
          {
            fallback: { items: [] },
            errorMessage: t('warranty_claims.troubleshootingGuides.edit.error.load', 'Failed to load troubleshooting guide.'),
          },
        )
        if (cancelled) return
        const item = (payload.items ?? [])
          .map(normalizeTroubleshootingGuide)
          .find((entry): entry is TroubleshootingGuideRecord => entry !== null) ?? null
        if (!item) {
          setGuide(null)
          setError(t('warranty_claims.troubleshootingGuides.edit.notFound', 'Troubleshooting guide not found.'))
          return
        }
        setGuide(item)
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t('warranty_claims.troubleshootingGuides.edit.error.load', 'Failed to load troubleshooting guide.'),
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (id) void loadGuide()
    return () => {
      cancelled = true
    }
  }, [id, t])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('warranty_claims.troubleshootingGuides.edit.loading', 'Loading troubleshooting guide...')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !guide) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('warranty_claims.troubleshootingGuides.edit.notFound', 'Troubleshooting guide not found.')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<TroubleshootingGuideFormValues>
          title={t('warranty_claims.troubleshootingGuides.edit.title', 'Edit troubleshooting guide')}
          backHref="/backend/warranty_claims/troubleshooting-guides"
          fields={fields}
          groups={groups}
          initialValues={toTroubleshootingGuideInitialValues(guide)}
          submitLabel={t('warranty_claims.troubleshootingGuides.form.submit.update', 'Save guide')}
          cancelHref="/backend/warranty_claims/troubleshooting-guides"
          entityId="warranty_claims:warranty_troubleshooting_guide"
          onSubmit={async (values) => {
            await updateCrud(
              'warranty_claims/troubleshooting-guides',
              buildTroubleshootingGuidePayload(values, t, guide.id),
              {
                errorMessage: t('warranty_claims.troubleshootingGuides.edit.error.save', 'Failed to save troubleshooting guide.'),
              },
            )
            flash(t('warranty_claims.troubleshootingGuides.edit.success', 'Troubleshooting guide saved.'), 'success')
            router.push('/backend/warranty_claims/troubleshooting-guides')
          }}
          onDelete={async () => {
            await deleteCrud('warranty_claims/troubleshooting-guides', guide.id, {
              errorMessage: t('warranty_claims.troubleshootingGuides.edit.error.delete', 'Failed to delete troubleshooting guide.'),
            })
            flash(t('warranty_claims.troubleshootingGuides.edit.deleted', 'Troubleshooting guide deleted.'), 'success')
            router.push('/backend/warranty_claims/troubleshooting-guides')
          }}
        />
      </PageBody>
    </Page>
  )
}
