"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { E } from '#generated/entities.ids.generated'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { crudFormExtensionSpotId } from '@open-mercato/shared/modules/widgets/extension-points'
import { extensionPoints } from '@open-mercato/core/modules/customers/extension-points'
import {
  buildCompanyPayload,
  createCompanyFormFields,
  createCompanyFormGroups,
  createCompanyFormSchema,
  type CompanyFormValues,
} from '../../../../components/formConfig'
import { useCustomerAddressCustomFields } from '../../../../components/detail/hooks/useCustomerAddressCustomFields'
import { useCustomerAddressDraftSubmission } from '../../../../components/detail/hooks/useCustomerAddressDraftSubmission'
import { CustomerAddressDraftRecovery } from '../../../../components/CustomerAddressDraftRecovery'

const COMPANY_CREATE_LEGACY_INJECTION_SPOT_ID = crudFormExtensionSpotId('customers.customer_entity')
const NON_ADDRESS_GROUPS = ['details', 'profile', 'notes', 'customFields']

export default function CreateCompanyPage() {
  const t = useT()
  const locale = useLocale()
  const searchParams = useSearchParams()
  const scope = useOrganizationScopeDetail()
  const customFields = useCustomerAddressCustomFields(t)
  const { addressDrafts, recovery, confirmAddressOutcome, submit } = useCustomerAddressDraftSubmission(t, customFields, scope)

  const formSchema = React.useMemo(() => createCompanyFormSchema(), [])
  const fields = React.useMemo(() => createCompanyFormFields(t, { addressDrafts }), [addressDrafts, t])
  const groups = React.useMemo(() => createCompanyFormGroups(t), [t])
  const returnTo = searchParams.get('returnTo')
  const initialValues = React.useMemo<Partial<CompanyFormValues>>(() => ({ addresses: [] }), [])

  return (
    <Page>
      <PageBody>
        <CrudForm<CompanyFormValues>
          title={t('customers.companies.create.title')}
          titleHeadingLevel={1}
          backHref={returnTo ?? '/backend/customers/companies'}
          fields={fields}
          groups={groups}
          hiddenGroupIds={recovery ? NON_ADDRESS_GROUPS : undefined}
          readOnly={Boolean(recovery?.unconfirmedAddressId)}
          contentHeader={recovery ? (
            <CustomerAddressDraftRecovery
              kind="companies"
              customerId={recovery.id}
              unconfirmed={Boolean(recovery.unconfirmedAddressId)}
              onConfirm={confirmAddressOutcome}
            />
          ) : undefined}
          initialValues={initialValues}
          injectionSpotId={extensionPoints.hosts.companyForm.spotId}
          legacyInjectionSpotId={COMPANY_CREATE_LEGACY_INJECTION_SPOT_ID}
          entityId="customers.company"
          resourceKind="customers.company"
          entityIds={[E.customers.customer_entity, E.customers.customer_company_profile]}
          submitLabel={t(recovery ? 'customers.people.detail.addresses.retrySave' : 'customers.companies.form.submit')}
          cancelHref={returnTo ?? '/backend/customers/companies'}
          schema={formSchema}
          onSubmit={async (values) => {
            const newId = await submit(values.addresses, async (organizationId) => {
              let payload: Record<string, unknown>
              try {
                payload = buildCompanyPayload(values, organizationId, locale)
              } catch (err) {
                if (err instanceof Error) {
                  if (err.message === 'DISPLAY_NAME_REQUIRED') {
                    const message = t('customers.companies.form.displayName.error')
                    throw createCrudFormError(message, { displayName: message })
                  }
                  if (err.message === 'ANNUAL_REVENUE_INVALID') {
                    const message = t('customers.companies.form.annualRevenue.error')
                    throw createCrudFormError(message, { annualRevenue: message })
                  }
                }
                throw err
              }
              const { result } = await createCrud<{ id?: string; entityId?: string }>('customers/companies', payload)
              return result
            })
            flash(t('customers.companies.form.success'), 'success')
            return newId ? { resourceId: newId } : undefined
          }}
          successRedirect={(_values, result) => {
            const newId = result?.resourceId
            return returnTo || (newId ? `/backend/customers/companies-v2/${newId}` : '/backend/customers/companies')
          }}
        />
      </PageBody>
    </Page>
  )
}
