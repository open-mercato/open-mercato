"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  buildVendorPolicyPayload,
  useVendorPolicyFormConfig,
  type VendorPolicyFormValues,
} from '../vendorPolicyForm'

export default function CreateWarrantyVendorPolicyPage() {
  const t = useT()
  const router = useRouter()
  const { fields, groups } = useVendorPolicyFormConfig(t)

  const initialValues = React.useMemo<Partial<VendorPolicyFormValues>>(() => ({
    claimableReasonCodesCsv: '',
    autoGenerateRecovery: false,
    isActive: true,
  }), [])

  return (
    <Page>
      <PageBody>
        <CrudForm<VendorPolicyFormValues>
          title={t('warranty_claims.vendorPolicies.create.title', 'New vendor policy')}
          backHref="/backend/warranty_claims/vendor-policies"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('warranty_claims.vendorPolicies.form.submit.create', 'Create vendor policy')}
          cancelHref="/backend/warranty_claims/vendor-policies"
          entityId="warranty_claims:warranty_vendor_policy"
          onSubmit={async (values) => {
            const call = await createCrud<{ id?: string | null }>('warranty_claims/vendor-policies', buildVendorPolicyPayload(values), {
              errorMessage: t('warranty_claims.vendorPolicies.create.error.save', 'Failed to create vendor policy.'),
            })
            flash(t('warranty_claims.vendorPolicies.create.success', 'Vendor policy created.'), 'success')
            const id = call.result?.id
            router.push(id ? `/backend/warranty_claims/vendor-policies/${id}/edit` : '/backend/warranty_claims/vendor-policies')
          }}
        />
      </PageBody>
    </Page>
  )
}
