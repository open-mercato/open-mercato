"use client"

import * as React from 'react'
import { Building2, Hash, Users, BarChart3 } from 'lucide-react'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { CollapsibleZoneLayout, type ZoneSectionDescriptor } from '@open-mercato/ui/backend/crud/CollapsibleZoneLayout'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { E } from '#generated/entities.ids.generated'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { z } from 'zod'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import {
  buildCompanyEditPayload,
  createCompanyEditFields,
  createCompanyDaneFiremyGroups,
  createCompanyEditSchema,
  mapCompanyOverviewToFormValues,
  type CompanyEditFormValues,
  type CompanyOverview,
} from '../formConfig'

type CompanyDataTabProps = {
  data: CompanyOverview
  onDataRefresh: () => Promise<void>
  onSubmitRefReady?: (submitFn: () => void) => void
  onDirtyChange?: (dirty: boolean) => void
  onSavingChange?: (saving: boolean) => void
  zone2?: React.ReactNode
}

export function CompanyDataTab({
  data,
  onDataRefresh,
  onSubmitRefReady,
  onDirtyChange,
  onSavingChange,
  zone2,
}: CompanyDataTabProps) {
  const t = useT()
  const { organizationId } = useOrganizationScopeDetail()

  const formSchema = React.useMemo(() => createCompanyEditSchema(), [])
  const fields = React.useMemo(() => createCompanyEditFields(t), [t])
  const groups = React.useMemo(() => createCompanyDaneFiremyGroups(t), [t])

  const initialValues = React.useMemo(
    () => mapCompanyOverviewToFormValues(data),
    [data],
  )

  const formWrapperRef = React.useRef<HTMLDivElement>(null)
  const [isDirty, setIsDirty] = React.useState(false)

  const companyName = data.company?.displayName ?? ''

  const zoneSections = React.useMemo<ZoneSectionDescriptor[]>(() => [
    { id: 'identity', icon: Building2, label: t('customers.companies.form.sections.identity', 'Identity') },
    { id: 'contact', icon: Hash, label: t('customers.companies.form.sections.contact', 'Contact') },
    { id: 'classification', icon: Users, label: t('customers.companies.form.sections.classification', 'Classification') },
    { id: 'profile', icon: BarChart3, label: t('customers.companies.form.sections.businessProfile', 'Business profile') },
  ], [t])

  const handleDirtyChange = React.useCallback((dirty: boolean) => {
    setIsDirty(dirty)
    onDirtyChange?.(dirty)
  }, [onDirtyChange])

  React.useEffect(() => {
    if (onSubmitRefReady) {
      onSubmitRefReady(() => {
        const form = formWrapperRef.current?.querySelector('form')
        if (form) form.requestSubmit()
      })
    }
  }, [onSubmitRefReady])

  const handleSubmit = React.useCallback(
    async (values: CompanyEditFormValues) => {
      onSavingChange?.(true)
      try {
        let payload: Record<string, unknown>
        try {
          payload = buildCompanyEditPayload(values, organizationId)
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

        await updateCrud('customers/companies', payload)
        flash(t('customers.companies.form.updateSuccess', 'Company updated.'), 'success')
        await onDataRefresh()
      } finally {
        onSavingChange?.(false)
      }
    },
    [onDataRefresh, organizationId, t, onSavingChange],
  )

  const handleDelete = React.useCallback(async () => {
    await deleteCrud('customers/companies', { id: data.company.id })
    flash(t('customers.companies.list.deleteSuccess', 'Company deleted.'), 'success')
  }, [data.company.id, t])

  const companyId = data.company.id

  return (
    <CollapsibleZoneLayout
      pageType="company-v2"
      entityName={companyName}
      isDirty={isDirty}
      sections={zoneSections}
      zone1={
        <div ref={formWrapperRef}>
          <CrudForm<CompanyEditFormValues>
            embedded
            injectionSpotId="customers.company"
            entityIds={[E.customers.customer_entity, E.customers.customer_company_profile]}
            schema={formSchema}
            fields={fields}
            groups={groups}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            onDelete={handleDelete}
            hideFooterActions
            collapsibleGroups={{ pageType: 'company-v2', chevronPosition: 'left' }}
            sortableGroups={{ pageType: 'company-v2' }}
            onDirtyChange={handleDirtyChange}
          />
        </div>
      }
      zone2={
        zone2 ? (
          <div className="min-w-0 space-y-4">{zone2}</div>
        ) : null
      }
    />
  )
}
