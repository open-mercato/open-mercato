"use client"

import * as React from 'react'
import { z } from 'zod'
import { FileText } from 'lucide-react'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CustomerGroupTermsPriceKindField } from './CustomerGroupTermsPriceKindField'

export type CustomerGroupTermsDTO = {
  id: string
  groupId: string
  organizationId: string | null
  tenantId: string
  priceKindId: string | null
  paymentTermsDays: number | null
  allowPurchaseOnAccount: boolean
  defaultCreditLimit: number | null
  creditCurrencyCode: string | null
  approvalRequiredAbove: number | null
  minOrderValue: number | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

type CustomerGroupTermsFormValues = {
  priceKindId: string
  paymentTermsDays?: number
  allowPurchaseOnAccount: boolean
  defaultCreditLimit?: number
  creditCurrencyCode: string
  approvalRequiredAbove?: number
  minOrderValue?: number
}

function mapTermsToFormValues(terms: CustomerGroupTermsDTO | null): CustomerGroupTermsFormValues {
  return {
    priceKindId: terms?.priceKindId ?? '',
    paymentTermsDays: terms?.paymentTermsDays ?? undefined,
    allowPurchaseOnAccount: terms?.allowPurchaseOnAccount ?? false,
    defaultCreditLimit: terms?.defaultCreditLimit ?? undefined,
    creditCurrencyCode: terms?.creditCurrencyCode ?? '',
    approvalRequiredAbove: terms?.approvalRequiredAbove ?? undefined,
    minOrderValue: terms?.minOrderValue ?? undefined,
  }
}

export function CustomerGroupTermsSection({
  groupId,
  terms,
  loading,
  onSaved,
}: {
  groupId: string
  // `undefined` = still loading, `null` = confirmed no terms row for this group
  // (spec: "No terms set — inheriting from parent / tenant defaults"), object = loaded row.
  terms: CustomerGroupTermsDTO | null | undefined
  loading: boolean
  onSaved: (next: CustomerGroupTermsDTO) => void
}) {
  const t = useT()
  // Once the user starts filling out terms for a group that has none yet, keep the
  // form mounted even while the in-flight save briefly leaves `terms` as `null` —
  // otherwise the empty state would flash back before `onSaved` lands.
  const [editing, setEditing] = React.useState(false)
  const hasTerms = terms != null
  const showForm = hasTerms || editing

  const negativeMessage = t('customer_groups.groups.form.terms.errors.negative', 'Must be zero or greater.')

  const schema = React.useMemo(
    () =>
      z.object({
        priceKindId: z.string().trim(),
        paymentTermsDays: z.coerce.number().int().min(0, negativeMessage).optional(),
        allowPurchaseOnAccount: z.boolean(),
        defaultCreditLimit: z.coerce.number().min(0, negativeMessage).optional(),
        creditCurrencyCode: z
          .string()
          .trim()
          .max(4, t('customer_groups.groups.form.terms.errors.currencyLength', 'Use up to 4 characters.')),
        approvalRequiredAbove: z.coerce.number().min(0, negativeMessage).optional(),
        minOrderValue: z.coerce.number().min(0, negativeMessage).optional(),
      }),
    [negativeMessage, t],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'priceKindId',
        label: t('customer_groups.groups.form.terms.field.priceKind', 'Price kind'),
        type: 'custom',
        component: ({ value, setValue, disabled }) => (
          <CustomerGroupTermsPriceKindField
            value={typeof value === 'string' ? value : ''}
            onChange={setValue}
            disabled={disabled}
          />
        ),
      },
      {
        id: 'paymentTermsDays',
        label: t('customer_groups.groups.form.terms.field.paymentTermsDays', 'Payment terms (days)'),
        type: 'number',
        layout: 'half',
      },
      {
        id: 'allowPurchaseOnAccount',
        label: '',
        type: 'custom',
        layout: 'half',
        component: ({ value, setValue, disabled }) => (
          <SwitchField
            label={t('customer_groups.groups.form.terms.field.allowPurchaseOnAccount', 'Allow purchase on account')}
            checked={value === true}
            disabled={disabled}
            onCheckedChange={(next) => setValue(next === true)}
          />
        ),
      },
      {
        id: 'defaultCreditLimit',
        label: t('customer_groups.groups.form.terms.field.defaultCreditLimit', 'Default credit limit'),
        type: 'number',
        layout: 'half',
      },
      {
        id: 'creditCurrencyCode',
        label: t('customer_groups.groups.form.terms.field.creditCurrencyCode', 'Credit currency'),
        type: 'text',
        layout: 'half',
        placeholder: t('customer_groups.groups.form.terms.field.creditCurrencyCodePlaceholder', 'e.g., USD'),
        maxLength: 4,
      },
      {
        id: 'approvalRequiredAbove',
        label: t('customer_groups.groups.form.terms.field.approvalRequiredAbove', 'Approval required above'),
        type: 'number',
        layout: 'half',
      },
      {
        id: 'minOrderValue',
        label: t('customer_groups.groups.form.terms.field.minOrderValue', 'Minimum order value'),
        type: 'number',
        layout: 'half',
      },
    ],
    [t],
  )

  const initialValues = React.useMemo(() => mapTermsToFormValues(terms ?? null), [terms])

  const handleSubmit = React.useCallback(
    async (values: CustomerGroupTermsFormValues) => {
      const payload: Record<string, unknown> = {
        priceKindId: values.priceKindId && values.priceKindId.trim().length ? values.priceKindId : null,
        paymentTermsDays: typeof values.paymentTermsDays === 'number' ? values.paymentTermsDays : null,
        allowPurchaseOnAccount: values.allowPurchaseOnAccount === true,
        defaultCreditLimit: typeof values.defaultCreditLimit === 'number' ? values.defaultCreditLimit : null,
        creditCurrencyCode:
          values.creditCurrencyCode && values.creditCurrencyCode.trim().length
            ? values.creditCurrencyCode.trim().toUpperCase()
            : null,
        approvalRequiredAbove:
          typeof values.approvalRequiredAbove === 'number' ? values.approvalRequiredAbove : null,
        minOrderValue: typeof values.minOrderValue === 'number' ? values.minOrderValue : null,
      }
      // `updateCrud` PUTs to `/api/customer-groups/{groupId}/terms`, matching the
      // upsert route (Step 2.4). `optimisticLockUpdatedAt` below is `null` on the
      // first save (no `terms` row yet), so CrudForm skips the lock header entirely —
      // mirrors the route's own "no lock check on creation" behavior.
      const call = await updateCrud<{ terms: CustomerGroupTermsDTO }>(`customer-groups/${groupId}/terms`, payload, {
        errorMessage: t('customer_groups.groups.form.terms.errors.save', 'Failed to save commercial terms.'),
      })
      if (call.result?.terms) onSaved(call.result.terms)
      flash(t('customer_groups.groups.form.terms.flash.saved', 'Commercial terms saved.'), 'success')
    },
    [groupId, onSaved, t],
  )

  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-4">
      <SectionHeader title={t('customer_groups.groups.form.terms.title', 'Commercial terms')} />
      {loading ? (
        <LoadingMessage label={t('customer_groups.groups.form.terms.loading', 'Loading commercial terms…')} />
      ) : !showForm ? (
        <EmptyState
          size="sm"
          variant="subtle"
          icon={<FileText className="h-5 w-5" aria-hidden />}
          title={t(
            'customer_groups.groups.form.terms.empty.title',
            'No terms set — inheriting from parent / tenant defaults',
          )}
          description={t(
            'customer_groups.groups.form.terms.empty.description',
            'This group currently uses commercial terms inherited from its parent group or the tenant defaults. Set explicit terms to override them for this group.',
          )}
          actions={(
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('customer_groups.groups.form.terms.empty.action', 'Set terms for this group')}
            </Button>
          )}
          className="border border-dashed border-border"
        />
      ) : (
        <CrudForm<CustomerGroupTermsFormValues>
          key={terms?.updatedAt ?? 'new'}
          embedded
          schema={schema}
          fields={fields}
          initialValues={initialValues}
          optimisticLockUpdatedAt={terms?.updatedAt ?? null}
          submitLabel={t('customer_groups.groups.form.terms.action.save', 'Save terms')}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}

export default CustomerGroupTermsSection
