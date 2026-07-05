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
  buildVendorPolicyPayload,
  normalizeVendorPolicy,
  toVendorPolicyInitialValues,
  useVendorPolicyFormConfig,
  type VendorPolicyFormValues,
  type VendorPolicyRecord,
} from '../../vendorPolicyForm'

export default function EditWarrantyVendorPolicyPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : ''
  const [policy, setPolicy] = React.useState<VendorPolicyRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const { fields, groups } = useVendorPolicyFormConfig(t)

  React.useEffect(() => {
    let cancelled = false
    async function loadPolicy() {
      setLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<{ items?: unknown[] }>(
          `/api/warranty_claims/vendor-policies?ids=${encodeURIComponent(id)}&page=1&pageSize=1`,
          undefined,
          {
            fallback: { items: [] },
            errorMessage: t('warranty_claims.vendorPolicies.edit.error.load', 'Failed to load vendor policy.'),
          },
        )
        if (cancelled) return
        const item = (payload.items ?? [])
          .map(normalizeVendorPolicy)
          .find((entry): entry is VendorPolicyRecord => entry !== null) ?? null
        if (!item) {
          setPolicy(null)
          setError(t('warranty_claims.vendorPolicies.edit.notFound', 'Vendor policy not found.'))
          return
        }
        setPolicy(item)
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t('warranty_claims.vendorPolicies.edit.error.load', 'Failed to load vendor policy.'),
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (id) void loadPolicy()
    return () => {
      cancelled = true
    }
  }, [id, t])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('warranty_claims.vendorPolicies.edit.loading', 'Loading vendor policy...')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !policy) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('warranty_claims.vendorPolicies.edit.notFound', 'Vendor policy not found.')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<VendorPolicyFormValues>
          title={t('warranty_claims.vendorPolicies.edit.title', 'Edit vendor policy')}
          backHref="/backend/warranty_claims/vendor-policies"
          fields={fields}
          groups={groups}
          initialValues={toVendorPolicyInitialValues(policy)}
          submitLabel={t('warranty_claims.vendorPolicies.form.submit.update', 'Save vendor policy')}
          cancelHref="/backend/warranty_claims/vendor-policies"
          entityId="warranty_claims:warranty_vendor_policy"
          onSubmit={async (values) => {
            await updateCrud('warranty_claims/vendor-policies', buildVendorPolicyPayload(values, policy.id), {
              errorMessage: t('warranty_claims.vendorPolicies.edit.error.save', 'Failed to save vendor policy.'),
            })
            flash(t('warranty_claims.vendorPolicies.edit.success', 'Vendor policy saved.'), 'success')
            router.push('/backend/warranty_claims/vendor-policies')
          }}
          onDelete={async () => {
            await deleteCrud('warranty_claims/vendor-policies', policy.id, {
              errorMessage: t('warranty_claims.vendorPolicies.edit.error.delete', 'Failed to delete vendor policy.'),
            })
            flash(t('warranty_claims.vendorPolicies.edit.deleted', 'Vendor policy deleted.'), 'success')
            router.push('/backend/warranty_claims/vendor-policies')
          }}
        />
      </PageBody>
    </Page>
  )
}
