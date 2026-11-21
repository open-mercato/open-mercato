"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { E } from '#generated/entities.ids.generated'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { extensionPoints } from '../../../../extension-points'
import {
  buildPersonPayload,
  createPersonFormFields,
  createPersonFormGroups,
  createPersonFormSchema,
  type PersonFormValues,
} from '../../../../components/formConfig'
import { useCustomerAddressCustomFields } from '../../../../components/detail/hooks/useCustomerAddressCustomFields'
import { useCustomerAddressDraftSubmission } from '../../../../components/detail/hooks/useCustomerAddressDraftSubmission'
import { CustomerAddressDraftRecovery } from '../../../../components/CustomerAddressDraftRecovery'

const NON_ADDRESS_GROUPS = ['details', 'notes', 'customFields']

export default function CreatePersonPage() {
  const t = useT()
  const searchParams = useSearchParams()
  const scope = useOrganizationScopeDetail()
  const { organizationId } = scope
  const customFields = useCustomerAddressCustomFields(t)
  const { addressDrafts, recovery, confirmAddressOutcome, submit } = useCustomerAddressDraftSubmission(t, customFields, scope)

  const formSchema = React.useMemo(() => createPersonFormSchema(), [])
  const fields = React.useMemo(() => createPersonFormFields(t, { addressDrafts }), [addressDrafts, t])
  const groups = React.useMemo(() => createPersonFormGroups(t), [t])
  const returnTo = searchParams.get('returnTo')
  const companyParam = searchParams.get('companyId')
  const companyEntityId = React.useMemo(() => {
    if (!companyParam) return undefined
    const trimmed = companyParam.trim()
    return trimmed.length ? trimmed : undefined
  }, [companyParam])
  const initialValues = React.useMemo<Partial<PersonFormValues>>(
    () => ({
      addresses: [] as PersonFormValues['addresses'],
      ...(companyEntityId ? { companyEntityId } : {}),
    }),
    [companyEntityId],
  )

  return (
    <Page>
      <PageBody>
        <CrudForm<PersonFormValues>
          title={t('customers.people.create.title')}
          titleHeadingLevel={1}
          backHref={returnTo ?? '/backend/customers/people'}
          fields={fields}
          groups={groups}
          hiddenGroupIds={recovery ? NON_ADDRESS_GROUPS : undefined}
          contentHeader={recovery ? (
            <CustomerAddressDraftRecovery
              kind="people"
              customerId={recovery.id}
              unconfirmed={Boolean(recovery.unconfirmedAddressId)}
              onConfirm={confirmAddressOutcome}
            />
          ) : undefined}
          initialValues={initialValues}
          injectionSpotId={extensionPoints.hosts.personForm.spotId}
          legacyInjectionSpotId="crud-form:customers.customer_entity"
          entityId="customers.person"
          resourceKind="customers.person"
          entityIds={[E.customers.customer_entity, E.customers.customer_person_profile]}
          submitLabel={t(recovery ? 'customers.people.detail.addresses.retrySave' : 'customers.people.form.submit')}
          cancelHref={returnTo ?? '/backend/customers/people'}
          schema={formSchema}
          onSubmit={async (values) => {
            const newId = await submit(values.addresses, async () => {
              let payload: Record<string, unknown>
              try {
                payload = buildPersonPayload(values, organizationId)
              } catch (err) {
                if (err instanceof Error && err.message === 'DISPLAY_NAME_REQUIRED') {
                  const message = t('customers.people.form.displayName.error')
                  throw createCrudFormError(message, { displayName: message })
                }
                throw err
              }
              const { result } = await createCrud<{ id?: string; entityId?: string }>('customers/people', payload)
              return result
            })
            flash(t('customers.people.form.success'), 'success')
            return newId ? { resourceId: newId } : undefined
          }}
          successRedirect={(_values, result) => {
            const newId = result?.resourceId
            return returnTo || (newId ? `/backend/customers/people-v2/${newId}` : '/backend/customers/people')
          }}
        />
      </PageBody>
    </Page>
  )
}
