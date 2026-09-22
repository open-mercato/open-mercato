"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { customerGroupKindValues } from '../../../data/validators'
import {
  findDefaultConflict,
  mapListItemsToSummaries,
  type CustomerGroupSummary,
} from '../../../components/customerGroupTree'
import { CustomerGroupParentField } from '../../../components/CustomerGroupParentField'
import { CustomerGroupDefaultField } from '../../../components/CustomerGroupDefaultField'

type CustomerGroupFormValues = {
  code: string
  name: string
  description?: string
  kind: string
  parentId?: string | null
  priority?: number
  isDefault?: boolean
  isActive?: boolean
}

async function loadCustomerGroups(errorMessage: string): Promise<CustomerGroupSummary[]> {
  const response = await readApiResultOrThrow<{ items?: unknown[] }>(
    '/api/customer-groups?pageSize=100',
    undefined,
    { errorMessage, allowNullResult: true },
  )
  return mapListItemsToSummaries(response?.items)
}

async function submitCustomerGroupCreate(
  values: CustomerGroupFormValues,
  t: (key: string, fallback?: string) => string,
) {
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
    code,
    name,
    description,
    kind: values.kind,
    parentId: values.parentId ?? null,
    priority,
    isDefault: values.isDefault === true,
    isActive: values.isActive !== false,
  }
  await createCrud('customer-groups', payload)
}

export default function CreateCustomerGroupPage() {
  const t = useT()
  const [groups, setGroups] = React.useState<CustomerGroupSummary[]>([])
  const [groupsLoading, setGroupsLoading] = React.useState<boolean>(true)

  React.useEffect(() => {
    let cancelled = false
    const errorMessage = t('customer_groups.groups.form.errors.loadGroups', 'Failed to load customer groups')
    loadCustomerGroups(errorMessage)
      .then((items) => {
        if (!cancelled) setGroups(items)
      })
      .catch(() => {
        if (!cancelled) setGroups([])
      })
      .finally(() => {
        if (!cancelled) setGroupsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

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
            groups={groups}
            isLoading={groupsLoading}
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
        label: t('customer_groups.groups.form.field.isDefault', 'Default group'),
        type: 'custom',
        component: ({ value, setValue, disabled }) => (
          <CustomerGroupDefaultField
            value={value}
            setValue={setValue}
            disabled={disabled}
            conflictGroupName={findDefaultConflict(groups)?.name ?? null}
          />
        ),
      },
      {
        id: 'isActive',
        label: t('customer_groups.groups.form.field.isActive', 'Active'),
        type: 'checkbox',
      },
    ],
    [t, groups, groupsLoading],
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

  const successMessage = encodeURIComponent(t('customer_groups.groups.flash.created', 'Customer group created'))

  return (
    <Page>
      <PageBody>
        <CrudForm<CustomerGroupFormValues>
          title={t('customer_groups.groups.form.createTitle', 'Create customer group')}
          titleHeadingLevel={1}
          backHref="/backend/customer-groups"
          fields={fields}
          groups={groupConfig}
          entityId={E.customer_groups.customer_group}
          initialValues={{
            code: '',
            name: '',
            description: '',
            kind: 'b2c',
            parentId: '',
            priority: 0,
            isDefault: false,
            isActive: true,
          }}
          submitLabel={t('customer_groups.groups.form.action.create', 'Create')}
          cancelHref="/backend/customer-groups"
          successRedirect={`/backend/customer-groups?flash=${successMessage}&type=success`}
          onSubmit={async (values) => {
            await submitCustomerGroupCreate(values, t)
          }}
        />
      </PageBody>
    </Page>
  )
}
