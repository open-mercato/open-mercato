"use client"

import * as React from 'react'
import { Users } from 'lucide-react'
import { DealSectionCard } from './DealSectionCard'
import { DealFormField } from './DealFormField'
import { DealAssociationsField } from './DealAssociationsField'
import type { Translate } from './dealFormTypes'

export type DealAssociationsSectionProps = {
  tr: Translate
  personIds: string[]
  companyIds: string[]
  onPeopleChange: (next: string[]) => void
  onCompaniesChange: (next: string[]) => void
  disabled: boolean
}

export function DealAssociationsSection({
  tr,
  personIds,
  companyIds,
  onPeopleChange,
  onCompaniesChange,
  disabled,
}: DealAssociationsSectionProps) {
  const peopleLabels = {
    placeholder: tr('customers.deals.create.associations.peoplePlaceholder', 'Search people by name or email…'),
    empty: tr('customers.deals.form.people.empty', 'No people linked yet.'),
    loading: tr('customers.deals.form.people.loading', 'Searching people…'),
    noResults: tr('customers.deals.form.people.noResults', 'No people match your search.'),
    remove: tr('customers.deals.form.assignees.remove', 'Remove'),
    error: tr('customers.deals.form.people.error', 'Failed to load people.'),
  }
  const companyLabels = {
    placeholder: tr('customers.deals.create.associations.companiesPlaceholder', 'Search companies by name or domain…'),
    empty: tr('customers.deals.form.companies.empty', 'No companies linked yet.'),
    loading: tr('customers.deals.form.companies.loading', 'Searching companies…'),
    noResults: tr('customers.deals.form.companies.noResults', 'No companies match your search.'),
    remove: tr('customers.deals.form.assignees.remove', 'Remove'),
    error: tr('customers.deals.form.companies.error', 'Failed to load companies.'),
  }

  return (
    <DealSectionCard
      icon={Users}
      title={tr('customers.deals.create.sections.associations.title', 'Associations')}
      subtitle={tr('customers.deals.create.sections.associations.subtitle', 'Link people and companies to this deal')}
    >
      <DealFormField fieldId="personIds" label={tr('customers.people.detail.deals.fields.people', 'People')}>
        <DealAssociationsField
          kind="people"
          value={personIds}
          onChange={onPeopleChange}
          disabled={disabled}
          labels={peopleLabels}
        />
      </DealFormField>
      <DealFormField fieldId="companyIds" label={tr('customers.people.detail.deals.fields.companies', 'Companies')}>
        <DealAssociationsField
          kind="companies"
          value={companyIds}
          onChange={onCompaniesChange}
          disabled={disabled}
          labels={companyLabels}
        />
      </DealFormField>
    </DealSectionCard>
  )
}

export default DealAssociationsSection
