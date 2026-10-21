'use client'

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const ENTITY_ID = 'financial:ap_vendor'
const LIST_HREF = '/backend/financial/payables/vendors'
const RESOURCE = 'financial/ap/vendors'

export type VendorFormValues = {
  id: string
  code: string
  name: string
  nameAr: string
  vatNumber: string
  crNumber: string
  email: string
  phone: string
  countryCode: string
  isActive: 'true' | 'false'
  notes: string
  updatedAt?: string | null
}

export function toVendorFormValues(row: Record<string, unknown>): VendorFormValues {
  return {
    id: String(row.id ?? ''),
    code: String(row.code ?? ''),
    name: String(row.name ?? ''),
    nameAr: String(row.name_ar ?? ''),
    vatNumber: String(row.vat_number ?? ''),
    crNumber: String(row.cr_number ?? ''),
    email: String(row.email ?? ''),
    phone: String(row.phone ?? ''),
    countryCode: String(row.country_code ?? ''),
    isActive: row.is_active === false ? 'false' : 'true',
    notes: String(row.notes ?? ''),
    updatedAt: (row.updatedAt ?? row.updated_at ?? null) as string | null,
  }
}

export function emptyVendorForm(): VendorFormValues {
  return { id: '', code: '', name: '', nameAr: '', vatNumber: '', crNumber: '', email: '', phone: '', countryCode: 'SA', isActive: 'true', notes: '', updatedAt: null }
}

export function toVendorPayload(values: VendorFormValues): Record<string, unknown> {
  const optional = (value: string) => (value.trim().length > 0 ? value.trim() : null)
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    nameAr: optional(values.nameAr),
    vatNumber: optional(values.vatNumber),
    crNumber: optional(values.crNumber),
    email: optional(values.email),
    phone: optional(values.phone),
    countryCode: values.countryCode.trim() || null,
    isActive: values.isActive === 'true',
    notes: optional(values.notes),
  }
}

function useVendorFields(t: ReturnType<typeof useT>): CrudField[] {
  return React.useMemo(() => [
    { id: 'code', label: t('financial.ap.vendors.form.code', 'Code'), type: 'text', required: true },
    { id: 'name', label: t('financial.ap.vendors.form.name', 'Name'), type: 'text', required: true },
    { id: 'nameAr', label: t('financial.ap.vendors.form.nameAr', 'Name (Arabic)'), type: 'text' },
    { id: 'vatNumber', label: t('financial.ap.vendors.form.vatNumber', 'VAT number'), type: 'text' },
    { id: 'crNumber', label: t('financial.ap.vendors.form.crNumber', 'CR number'), type: 'text' },
    { id: 'email', label: t('financial.ap.vendors.form.email', 'Email'), type: 'text' },
    { id: 'phone', label: t('financial.ap.vendors.form.phone', 'Phone'), type: 'text' },
    { id: 'countryCode', label: t('financial.ap.vendors.form.countryCode', 'Country code'), type: 'text' },
    {
      id: 'isActive',
      label: t('financial.ap.vendors.form.isActive', 'Status'),
      type: 'select',
      options: [
        { value: 'true', label: t('financial.ap.vendors.status.active', 'Active') },
        { value: 'false', label: t('financial.ap.vendors.status.inactive', 'Inactive') },
      ],
    },
    { id: 'notes', label: t('financial.ap.vendors.form.notes', 'Notes'), type: 'textarea' },
  ], [t])
}

function useVendorGroups(t: ReturnType<typeof useT>): CrudFormGroup[] {
  return React.useMemo(() => [
    { id: 'identity', title: t('financial.ap.vendors.form.groups.identity', 'Identity'), column: 1, fields: ['code', 'name', 'nameAr'] },
    { id: 'compliance', title: t('financial.ap.vendors.form.groups.compliance', 'Compliance'), column: 2, fields: ['vatNumber', 'crNumber', 'countryCode'] },
    { id: 'contact', title: t('financial.ap.vendors.form.groups.contact', 'Contact'), column: 1, fields: ['email', 'phone'] },
    { id: 'status', title: t('financial.ap.vendors.form.groups.status', 'Status'), column: 2, fields: ['isActive', 'notes'] },
  ], [t])
}

export function VendorCreateForm() {
  const t = useT()
  const fields = useVendorFields(t)
  const groups = useVendorGroups(t)
  return (
    <CrudForm<VendorFormValues>
      title={t('financial.ap.vendors.form.create.title', 'New vendor')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={emptyVendorForm()}
      submitLabel={t('financial.ap.vendors.form.create.submit', 'Create vendor')}
      cancelHref={LIST_HREF}
      successRedirect={withFlash(LIST_HREF, t('financial.ap.vendors.form.flash.saved', 'Vendor saved.'), 'success')}
      onSubmit={async (values) => { await createCrud(RESOURCE, toVendorPayload(values)) }}
    />
  )
}

export function VendorEditForm({ id }: { id: string }) {
  const t = useT()
  const fields = useVendorFields(t)
  const groups = useVendorGroups(t)
  const [initial, setInitial] = React.useState<VendorFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const data = await fetchCrudList<Record<string, unknown>>(RESOURCE, { ids: id, pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) { if (!cancelled) setNotFound(true); return }
        if (!cancelled) setInitial(toVendorFormValues(item))
      } catch {
        if (!cancelled) setError(t('financial.ap.vendors.form.error.load', 'Could not load the vendor.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [id, t])

  if (notFound) return <RecordNotFoundState label={t('financial.ap.vendors.form.error.notFound', 'Vendor not found.')} backHref={LIST_HREF} backLabel={t('financial.ap.vendors.actions.back', 'Back to vendors')} />
  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<VendorFormValues>
      title={t('financial.ap.vendors.form.edit.title', 'Edit vendor')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? { ...emptyVendorForm(), id }}
      submitLabel={t('financial.ap.vendors.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={withFlash(LIST_HREF, t('financial.ap.vendors.form.flash.saved', 'Vendor saved.'), 'success')}
      isLoading={loading}
      onSubmit={async (values) => { await updateCrud(RESOURCE, { id, ...toVendorPayload(values) }) }}
      onDelete={async () => { await deleteCrud(RESOURCE, id) }}
    />
  )
}
