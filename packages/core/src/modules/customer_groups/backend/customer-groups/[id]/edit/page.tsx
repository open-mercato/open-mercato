"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { customerGroupKindValues } from '../../../../data/validators'
import {
  findDefaultConflict,
  mapListItemsToSummaries,
  mapListItemToSummary,
  type CustomerGroupSummary,
} from '../../../../components/customerGroupTree'
import { CustomerGroupParentField } from '../../../../components/CustomerGroupParentField'
import { CustomerGroupDefaultField } from '../../../../components/CustomerGroupDefaultField'
import {
  CustomerGroupTermsSection,
  type CustomerGroupTermsDTO,
} from '../../../../components/CustomerGroupTermsSection'

type CustomerGroupListResponse = {
  items?: unknown[]
}

type CustomerGroupTermsResponse = {
  terms?: CustomerGroupTermsDTO | null
}

type CustomerGroupFormValues = {
  id?: string
  code: string
  name: string
  description?: string
  kind: string
  parentId?: string | null
  priority?: number
  isDefault?: boolean
  isActive?: boolean
  updatedAt?: string | null
}

async function submitCustomerGroupUpdate(
  groupId: string,
  values: CustomerGroupFormValues,
  t: (key: string, fallback?: string) => string,
) {
  const resolvedId = typeof values.id === 'string' && values.id.length ? values.id : groupId
  if (!resolvedId) {
    const message = t('customer_groups.groups.form.errors.idRequired', 'Customer group identifier is required.')
    throw createCrudFormError(message, { id: message })
  }
  const code = typeof values.code === 'string' ? values.code.trim() : ''
  if (!code) {
    const message = t('customer_groups.groups.form.errors.code', 'Provide a group code.')
    throw createCrudFormError(message, { code: message })
  }
  const name = typeof values.name === 'string' ? values.name.trim() : ''
  if (!name) {
    const message = t('customer_groups.groups.form.errors.name', 'Provide the group name.')
    throw createCrudFormError(message, { name: message })
  }
  const description =
    typeof values.description === 'string' && values.description.trim().length
      ? values.description.trim()
      : undefined
  const priority = typeof values.priority === 'number' && Number.isFinite(values.priority) ? values.priority : 0
  const payload: Record<string, unknown> = {
    id: resolvedId,
    code,
    name,
    description,
    kind: values.kind,
    parentId: values.parentId ?? null,
    priority,
    isDefault: values.isDefault === true,
    isActive: values.isActive !== false,
  }
  await updateCrud('customer_groups/customer-groups', payload)
}

export default function EditCustomerGroupPage({ params }: { params?: { id?: string } }) {
  const groupId = params?.id ?? ''
  const t = useT()
  const [initialValues, setInitialValues] = React.useState<CustomerGroupFormValues | null>(null)
  const [defaultGroups, setDefaultGroups] = React.useState<CustomerGroupSummary[]>([])
  const [loading, setLoading] = React.useState<boolean>(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState<boolean>(false)
  // `undefined` = not fetched yet, `null` = confirmed no terms row for this group.
  const [terms, setTerms] = React.useState<CustomerGroupTermsDTO | null | undefined>(undefined)
  // A failed terms GET must never read as "no terms": saving from the empty state
  // would then skip the optimistic-lock header and overwrite the existing row.
  const [termsAccess, setTermsAccess] = React.useState<'ok' | 'forbidden' | 'error'>('ok')

  React.useEffect(() => {
    if (!groupId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const [recordCall, defaultsCall, termsCall] = await Promise.all([
          apiCall<CustomerGroupListResponse>(`/api/customer_groups/customer-groups?id=${encodeURIComponent(groupId)}`),
          apiCall<CustomerGroupListResponse>('/api/customer_groups/customer-groups?isDefault=true&pageSize=2'),
          apiCall<CustomerGroupTermsResponse>(`/api/customer_groups/customer-groups/${encodeURIComponent(groupId)}/terms`),
        ])
        if (!recordCall.ok) {
          if (recordCall.status === 404) {
            if (!cancelled) setIsNotFound(true)
            return
          }
          throw new Error(t('customer_groups.groups.form.errors.load', 'Failed to load customer group'))
        }
        const items = Array.isArray(recordCall.result?.items) ? recordCall.result.items : []
        const summary = mapListItemToSummary(items[0])
        if (!summary) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        const record = items[0] as Record<string, unknown>
        if (cancelled) return
        setInitialValues({
          id: summary.id,
          code: summary.code,
          name: summary.name,
          description: typeof record.description === 'string' ? record.description : '',
          kind: typeof record.kind === 'string' ? record.kind : 'b2c',
          parentId: summary.parentId ?? '',
          priority: typeof record.priority === 'number' ? record.priority : 0,
          isDefault: summary.isDefault,
          isActive: record.isActive === true || record.is_active === true,
          updatedAt: (record.updatedAt as string | undefined) ?? (record.updated_at as string | undefined) ?? null,
        })
        if (defaultsCall.ok) {
          setDefaultGroups(mapListItemsToSummaries(defaultsCall.result?.items))
        }
        if (termsCall.ok) {
          setTermsAccess('ok')
          setTerms(termsCall.result?.terms ?? null)
        } else {
          setTermsAccess(termsCall.status === 403 ? 'forbidden' : 'error')
          setTerms(undefined)
        }
      } catch (err) {
        if (!cancelled) {
          const fallback = t('customer_groups.groups.form.errors.load', 'Failed to load customer group')
          const message = err instanceof Error ? err.message : fallback
          setError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [groupId, t])

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'code',
        label: t('customer_groups.groups.form.field.code', 'Code'),
        type: 'text',
        required: true,
        placeholder: t('customer_groups.groups.form.field.codePlaceholder', 'e.g., wholesale-partners'),
        description: t(
          'customer_groups.groups.form.field.codeHelp',
          'Lowercase letters, numbers, dashes, or underscores only.',
        ),
      },
      {
        id: 'name',
        label: t('customer_groups.groups.form.field.name', 'Name'),
        type: 'text',
        required: true,
        placeholder: t('customer_groups.groups.form.field.namePlaceholder', 'e.g., Wholesale Partners'),
      },
      {
        id: 'description',
        label: t('customer_groups.groups.form.field.description', 'Description'),
        type: 'textarea',
      },
      {
        id: 'kind',
        label: t('customer_groups.groups.form.field.kind', 'Kind'),
        type: 'select',
        required: true,
        options: customerGroupKindValues.map((value) => ({
          value,
          label: t(`customer_groups.groups.form.field.kindOptions.${value}`, value),
        })),
      },
      {
        id: 'parentId',
        label: t('customer_groups.groups.form.field.parent', 'Parent group'),
        type: 'custom',
        component: ({ value, setValue, disabled }) => (
          <CustomerGroupParentField
            value={value}
            setValue={setValue}
            disabled={disabled}
            excludeId={groupId}
          />
        ),
      },
      {
        id: 'priority',
        label: t('customer_groups.groups.form.field.priority', 'Priority'),
        type: 'number',
        required: true,
        description: t(
          'customer_groups.groups.form.field.priorityHelp',
          'Whole number, 0 or greater. Higher priority groups are preferred when resolving pricing/terms.',
        ),
      },
      {
        id: 'isDefault',
        label: '',
        type: 'custom',
        component: ({ value, setValue, disabled }) => (
          <CustomerGroupDefaultField
            value={value}
            setValue={setValue}
            disabled={disabled}
            conflictGroupName={findDefaultConflict(defaultGroups, groupId)?.name ?? null}
          />
        ),
      },
      {
        id: 'isActive',
        label: t('customer_groups.groups.form.field.isActive', 'Active'),
        type: 'checkbox',
      },
    ],
    [t, defaultGroups, groupId],
  )

  const groupConfig = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'details',
        title: t('customer_groups.groups.form.group.details', 'Details'),
        column: 1,
        fields: ['code', 'name', 'description', 'kind'],
      },
      {
        id: 'hierarchy',
        title: t('customer_groups.groups.form.group.hierarchy', 'Hierarchy'),
        column: 1,
        fields: ['parentId', 'priority'],
      },
      {
        id: 'status',
        title: t('customer_groups.groups.form.group.status', 'Status'),
        column: 2,
        fields: ['isDefault', 'isActive'],
      },
    ],
    [t],
  )

  if (!groupId) {
    return (
      <Page>
        <PageBody>
          <p className="text-sm text-destructive">
            {t('customer_groups.groups.form.errors.idRequired', 'Customer group identifier is required.')}
          </p>
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('customer_groups.groups.form.errors.notFound', 'Customer group not found')}
            backHref="/backend/customer-groups"
            backLabel={t('customer_groups.groups.form.actions.backToList', 'Back to customer groups')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error && !loading) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<CustomerGroupFormValues>
          title={t('customer_groups.groups.form.editTitle', 'Edit customer group')}
          titleHeadingLevel={1}
          backHref="/backend/customer-groups"
          fields={fields}
          groups={groupConfig}
          entityId={E.customer_groups.customer_group}
          initialValues={
            initialValues ?? {
              id: groupId,
              code: '',
              name: '',
              description: '',
              kind: 'b2c',
              parentId: '',
              priority: 0,
              isDefault: false,
              isActive: true,
            }
          }
          optimisticLockUpdatedAt={initialValues?.updatedAt}
          isLoading={loading}
          loadingMessage={t('customer_groups.groups.form.loading', 'Loading customer group...')}
          submitLabel={t('customer_groups.groups.form.action.save', 'Save')}
          cancelHref="/backend/customer-groups"
          successRedirect={`/backend/customer-groups?flash=${encodeURIComponent(t('customer_groups.groups.flash.updated', 'Customer group updated'))}&type=success`}
          onSubmit={async (values) => {
            await submitCustomerGroupUpdate(groupId, values, t)
          }}
          onDelete={async () => {
            await deleteCrud('customer_groups/customer-groups', groupId, {
              errorMessage: t('customer_groups.groups.form.errors.delete', 'Failed to delete customer group'),
            })
          }}
          deleteRedirect={`/backend/customer-groups?flash=${encodeURIComponent(t('customer_groups.groups.flash.deleted', 'Customer group deleted'))}&type=success`}
        />
        {termsAccess === 'forbidden' ? null : (
          <CustomerGroupTermsSection
            groupId={groupId}
            terms={terms}
            loading={loading}
            loadError={
              termsAccess === 'error'
                ? t('customer_groups.groups.form.terms.errors.load', 'Failed to load commercial terms.')
                : null
            }
            onSaved={setTerms}
          />
        )}
      </PageBody>
    </Page>
  )
}
