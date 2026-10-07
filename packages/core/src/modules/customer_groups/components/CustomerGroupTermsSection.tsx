"use client"

import * as React from 'react'
import { z } from 'zod'
import { FileText } from 'lucide-react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { LookupMultiPicker } from '@open-mercato/ui/backend/inputs/LookupPickers'
import {
  categoryLookupSource,
  productLookupSource,
  tagLookupSource,
  type LookupSource,
} from '@open-mercato/ui/backend/inputs/lookupSources'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CustomerGroupTermsPriceKindField } from './CustomerGroupTermsPriceKindField'
import {
  buildAssortmentScopePayload,
  mapAssortmentScopeToFormValues,
  type AssortmentScopeField,
  type AssortmentScopeFormValues,
  type GroupAssortmentScope,
} from './customerGroupAssortmentScope'

export type CustomerGroupTermsDTO = {
  id: string
  groupId: string
  organizationId: string | null
  tenantId: string
  priceKindId: string | null
  paymentTermsDays: number | null
  allowPurchaseOnAccount: boolean | null
  defaultCreditLimit: number | null
  creditCurrencyCode: string | null
  approvalRequiredAbove: number | null
  minOrderValue: number | null
  assortmentScope?: GroupAssortmentScope | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

// `inherit` maps to `null` on the wire: the field is left unset on this group and
// resolves from the parent chain / tenant default, like the other terms fields.
const PURCHASE_ON_ACCOUNT_VALUES = ['inherit', 'allow', 'deny'] as const
type PurchaseOnAccountValue = (typeof PURCHASE_ON_ACCOUNT_VALUES)[number]

function toPurchaseOnAccountValue(value: boolean | null | undefined): PurchaseOnAccountValue {
  if (value === true) return 'allow'
  if (value === false) return 'deny'
  return 'inherit'
}

function fromPurchaseOnAccountValue(value: string | undefined): boolean | null {
  if (value === 'allow') return true
  if (value === 'deny') return false
  return null
}

type CustomerGroupTermsFormValues = AssortmentScopeFormValues & {
  priceKindId: string
  paymentTermsDays?: number
  allowPurchaseOnAccount: PurchaseOnAccountValue
  defaultCreditLimit?: number
  creditCurrencyCode: string
  approvalRequiredAbove?: number
  minOrderValue?: number
}

function mapTermsToFormValues(terms: CustomerGroupTermsDTO | null): CustomerGroupTermsFormValues {
  return {
    priceKindId: terms?.priceKindId ?? '',
    paymentTermsDays: terms?.paymentTermsDays ?? undefined,
    allowPurchaseOnAccount: toPurchaseOnAccountValue(terms?.allowPurchaseOnAccount),
    defaultCreditLimit: terms?.defaultCreditLimit ?? undefined,
    creditCurrencyCode: terms?.creditCurrencyCode ?? '',
    approvalRequiredAbove: terms?.approvalRequiredAbove ?? undefined,
    minOrderValue: terms?.minOrderValue ?? undefined,
    ...mapAssortmentScopeToFormValues(terms?.assortmentScope),
  }
}

const TERMS_FIELD_IDS = [
  'priceKindId',
  'paymentTermsDays',
  'allowPurchaseOnAccount',
  'defaultCreditLimit',
  'creditCurrencyCode',
  'approvalRequiredAbove',
  'minOrderValue',
]

function toIdList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function scopePickerField(
  id: AssortmentScopeField,
  label: string,
  placeholder: string,
  source: LookupSource,
  readOnly: boolean,
): CrudField {
  return {
    id,
    type: 'custom',
    label,
    disabled: readOnly,
    component: ({ value, setValue, disabled }) => (
      <LookupMultiPicker
        source={source}
        value={toIdList(value)}
        onChange={(next) => setValue(next)}
        placeholder={placeholder}
        disabled={disabled || readOnly}
      />
    ),
  }
}

export function CustomerGroupTermsSection({
  groupId,
  terms,
  loading,
  loadError,
  canManage,
  onSaved,
}: {
  groupId: string
  // `undefined` = still loading, `null` = confirmed no terms row for this group
  // (spec: "No terms set — inheriting from parent / tenant defaults"), object = loaded row.
  terms: CustomerGroupTermsDTO | null | undefined
  loading: boolean
  // Set when the terms GET failed for a reason other than "no row" — the form is
  // then withheld so a save can never overwrite terms it could not read.
  loadError?: string | null
  // Without `customer_groups.terms.manage` the terms stay viewable but the form is
  // read-only and the empty state offers no "set terms" action — a save would 403.
  canManage: boolean
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
        allowPurchaseOnAccount: z.enum(PURCHASE_ON_ACCOUNT_VALUES),
        defaultCreditLimit: z.coerce.number().min(0, negativeMessage).optional(),
        creditCurrencyCode: z
          .string()
          .trim()
          .max(4, t('customer_groups.groups.form.terms.errors.currencyLength', 'Use up to 4 characters.')),
        approvalRequiredAbove: z.coerce.number().min(0, negativeMessage).optional(),
        minOrderValue: z.coerce.number().min(0, negativeMessage).optional(),
        categoryIds: z.array(z.string()).default([]),
        tagIds: z.array(z.string()).default([]),
        excludeProductIds: z.array(z.string()).default([]),
        excludeCategoryIds: z.array(z.string()).default([]),
        excludeTagIds: z.array(z.string()).default([]),
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
        label: t('customer_groups.groups.form.terms.field.allowPurchaseOnAccount', 'Allow purchase on account'),
        type: 'select',
        layout: 'half',
        required: true,
        options: [
          {
            value: 'inherit',
            label: t('customer_groups.groups.form.terms.field.allowPurchaseOnAccountOptions.inherit', 'Inherit'),
          },
          {
            value: 'allow',
            label: t('customer_groups.groups.form.terms.field.allowPurchaseOnAccountOptions.allow', 'Allow'),
          },
          {
            value: 'deny',
            label: t('customer_groups.groups.form.terms.field.allowPurchaseOnAccountOptions.deny', 'Do not allow'),
          },
        ],
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
      scopePickerField(
        'categoryIds',
        t('customer_groups.groups.form.terms.assortment.field.categoryIds', 'Categories'),
        t('customer_groups.groups.form.terms.assortment.placeholder.category', 'Search categories'),
        categoryLookupSource,
        !canManage,
      ),
      scopePickerField(
        'tagIds',
        t('customer_groups.groups.form.terms.assortment.field.tagIds', 'Tags'),
        t('customer_groups.groups.form.terms.assortment.placeholder.tag', 'Search tags'),
        tagLookupSource,
        !canManage,
      ),
      scopePickerField(
        'excludeProductIds',
        t('customer_groups.groups.form.terms.assortment.field.excludeProductIds', 'Products'),
        t('customer_groups.groups.form.terms.assortment.placeholder.product', 'Search products'),
        productLookupSource,
        !canManage,
      ),
      scopePickerField(
        'excludeCategoryIds',
        t('customer_groups.groups.form.terms.assortment.field.excludeCategoryIds', 'Categories'),
        t('customer_groups.groups.form.terms.assortment.placeholder.category', 'Search categories'),
        categoryLookupSource,
        !canManage,
      ),
      scopePickerField(
        'excludeTagIds',
        t('customer_groups.groups.form.terms.assortment.field.excludeTagIds', 'Tags'),
        t('customer_groups.groups.form.terms.assortment.placeholder.tag', 'Search tags'),
        tagLookupSource,
        !canManage,
      ),
    ],
    [canManage, t],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      { id: 'terms', fields: TERMS_FIELD_IDS },
      {
        id: 'assortmentInclude',
        title: t('customer_groups.groups.form.terms.assortment.includeTitle', 'Assortment scope: show only products in'),
        description: t(
          'customer_groups.groups.form.terms.assortment.includeHint',
          "A product is visible to this group when it is in any of the chosen categories and carries any of the chosen tags. An empty picker does not filter, so leave both empty for no restriction; clearing a picker never hides everything. The storefront assortment a buyer sees is the channel's scope narrowed by this group's scope, and a buyer in several groups sees the union of their scopes.",
        ),
        fields: ['categoryIds', 'tagIds'],
      },
      {
        id: 'assortmentExclude',
        title: t('customer_groups.groups.form.terms.assortment.excludeTitle', 'Always hide from this group'),
        description: t(
          'customer_groups.groups.form.terms.assortment.excludeHint',
          'Hidden products, categories and tags win over the selection above.',
        ),
        fields: ['excludeProductIds', 'excludeCategoryIds', 'excludeTagIds'],
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
        allowPurchaseOnAccount: fromPurchaseOnAccountValue(values.allowPurchaseOnAccount),
        defaultCreditLimit: typeof values.defaultCreditLimit === 'number' ? values.defaultCreditLimit : null,
        creditCurrencyCode:
          values.creditCurrencyCode && values.creditCurrencyCode.trim().length
            ? values.creditCurrencyCode.trim().toUpperCase()
            : null,
        approvalRequiredAbove:
          typeof values.approvalRequiredAbove === 'number' ? values.approvalRequiredAbove : null,
        minOrderValue: typeof values.minOrderValue === 'number' ? values.minOrderValue : null,
        assortmentScope: buildAssortmentScopePayload(values),
      }
      // `updateCrud` PUTs to `/api/customer_groups/customer-groups/{groupId}/terms`, matching the
      // upsert route (Step 2.4). `optimisticLockUpdatedAt` below is `null` on the
      // first save (no `terms` row yet), so CrudForm skips the lock header entirely —
      // mirrors the route's own "no lock check on creation" behavior.
      const call = await updateCrud<{ terms: CustomerGroupTermsDTO }>(`customer_groups/customer-groups/${groupId}/terms`, payload, {
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
      ) : loadError ? (
        <ErrorMessage label={loadError} />
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
          actions={canManage ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('customer_groups.groups.form.terms.empty.action', 'Set terms for this group')}
            </Button>
          ) : undefined}
          className="border border-dashed border-border"
        />
      ) : (
        <CrudForm<CustomerGroupTermsFormValues>
          key={terms?.updatedAt ?? 'new'}
          embedded
          disableInitialFocus
          schema={schema}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          optimisticLockUpdatedAt={terms?.updatedAt ?? null}
          readOnly={!canManage}
          readOnlyOverlay={(
            <div className="rounded-xl border border-border/70 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm">
              {t(
                'customer_groups.groups.form.terms.readOnly',
                'You do not have permission to change commercial terms.',
              )}
            </div>
          )}
          submitLabel={t('customer_groups.groups.form.terms.action.save', 'Save terms')}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}

export default CustomerGroupTermsSection
