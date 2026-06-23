"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LeadForm, type LeadFormSubmitPayload } from '../../../../components/detail/LeadForm'

export default function CreateLeadPage() {
  const t = useT()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleCancel = React.useCallback(() => {
    router.push('/backend/customers/leads')
  }, [router])

  const handleSubmit = React.useCallback(
    async ({ base, custom }: LeadFormSubmitPayload) => {
      if (isSubmitting) return
      setIsSubmitting(true)
      try {
        const payload: Record<string, unknown> = {
          title: base.title,
          status: base.status ?? undefined,
          source: base.source ?? undefined,
          estimatedValueAmount: typeof base.estimatedValueAmount === 'number' ? base.estimatedValueAmount : undefined,
          estimatedValueCurrency: base.estimatedValueCurrency ?? undefined,
          companyName: base.companyName ?? undefined,
          companyVatId: base.companyVatId ?? undefined,
          contactFirstName: base.contactFirstName ?? undefined,
          contactLastName: base.contactLastName ?? undefined,
          contactPhone: base.contactPhone ?? undefined,
          contactEmail: base.contactEmail ?? undefined,
          description: base.description ?? undefined,
        }
        if (Object.keys(custom).length) payload.customFields = custom

        await createCrud('customers/leads', payload, {
          errorMessage: t('customers.leads.create.error', 'Failed to create lead.'),
        })
        flash(t('customers.leads.detail.saveSuccess', 'Lead created.'), 'success')
        router.push('/backend/customers/leads')
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('customers.leads.create.error', 'Failed to create lead.')
        flash(message, 'error')
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setIsSubmitting(false)
      }
    },
    [isSubmitting, router, t],
  )

  return (
    <Page>
      <PageBody>
        <LeadForm
          mode="create"
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
          submitLabel={t('customers.leads.form.submit', 'Save lead')}
          embedded={false}
          title={t('customers.leads.create.title', 'Create lead')}
          backHref="/backend/customers/leads"
        />
      </PageBody>
    </Page>
  )
}
