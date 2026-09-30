"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { customerGroupKindValues } from '../../../data/validators'
import {
  findDefaultConflict,
  mapListItemsToSummaries,
  nextFreePriority,
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

async function loadDefaultGroups(errorMessage: string): Promise<CustomerGroupSummary[]> {
  const response = await readApiResultOrThrow<{ items?: unknown[] }>(
    '/api/customer_groups/customer-groups?isDefault=true&pageSize=1',
    undefined,
    { errorMessage, allowNullResult: true },
  )
  return mapListItemsToSummaries(response?.items)
}

async function loadNextFreePriority(errorMessage: string): Promise<number> {
  const response = await readApiResultOrThrow<{ items?: unknown[] }>(
    '/api/customer_groups/customer-groups?sortField=priority&sortDir=desc&pageSize=1',
    undefined,
    { errorMessage, allowNullResult: true },
  )
  return nextFreePriority(response?.items)
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
  const { result } = await createCrud<{ id?: string | null; isDefault?: boolean }>(
    'customer_groups/customer-groups',
    payload,
  )
  if (payload.isDefault === true && result?.isDefault === false) {
    flash(
      t(
        'customer_groups.groups.flash.defaultNotApplied',
        'The group was created, but another group was made the default at the same time. Edit the group to make it the default.',
      ),
      'warning',
    )
  }
}

export default function CreateCustomerGroupPage() {
  const t = useT()
  const [defaultGroups, setDefaultGroups] = React.useState<CustomerGroupSummary[]>([])
  const [defaultGroupsLoading, setDefaultGroupsLoading] = React.useState<boolean>(true)
  const [initialPriority, setInitialPriority] = React.useState<number | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const errorMessage = t('customer_groups.groups.form.errors.loadGroups', 'Failed to load customer groups')
    loadNextFreePriority(errorMessage)
      .then((priority) => {
        if (!cancelled) setInitialPriority(priority)
      })
      .catch(() => {
        if (!cancelled) setInitialPriority(0)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  React.useEffect(() => {
    let cancelled = false
    const errorMessage = t('customer_groups.groups.form.errors.loadGroups', 'Failed to load customer groups')
    setDefaultGroupsLoading(true)
    loadDefaultGroups(errorMessage)
      .then((items) => {
        if (!cancelled) setDefaultGroups(items)
      })
      .catch(() => {
        if (!cancelled) setDefaultGroups([])
      })
      .finally(() => {
        if (!cancelled) setDefaultGroupsLoading(false)
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
          'Whole number, unique per tenant. When a customer belongs to several groups, the group with the higher number wins when resolving pricing and terms. The group list shows the lowest number first.',
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
            conflictGroupName={findDefaultConflict(defaultGroups)?.name ?? null}
            isLoading={defaultGroupsLoading}
          />
        ),
      },
      {
        id: 'isActive',
        label: t('customer_groups.groups.form.field.isActive', 'Active'),
        type: 'checkbox',
      },
    ],
    [t, defaultGroups, defaultGroupsLoading],
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

  const initialValues = React.useMemo<Partial<CustomerGroupFormValues>>(
    () => ({
      code: '',
      name: '',
      description: '',
      kind: 'b2c',
      parentId: '',
      priority: initialPriority ?? 0,
      isDefault: false,
      isActive: true,
    }),
    [initialPriority],
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
          initialValues={initialValues}
          isLoading={initialPriority === null}
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
