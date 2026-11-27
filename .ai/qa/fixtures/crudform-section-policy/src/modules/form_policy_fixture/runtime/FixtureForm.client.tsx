'use client'

import { CrudForm, type CrudField, type CrudFormProps } from '@open-mercato/ui/backend/CrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { crudFormSectionRuntime } from './host.client'

type Values = Record<string, unknown>
const hostResourceId = 'fixture-record'

export function FixtureForm({
  scenario, onSubmit, region,
}: {
  scenario: 'showcase' | 'c3'
  region?: string
  onSubmit?: CrudFormProps<Values>['onSubmit']
}) {
  const t = useT()
  const editing = scenario === 'showcase'
  const fields: CrudField[] = [
    { id: 'name', type: 'text', label: t('form_policy_fixture.fields.name') },
    { id: 'privateCode', type: 'text', label: t('form_policy_fixture.fields.private') },
    { id: 'displayName', type: 'text', label: t('form_policy_fixture.fields.replacement') },
  ]
  const identity = editing
    ? { formOperation: 'update' as const, resourceId: hostResourceId }
    : { formOperation: 'create' as const }
  return (
    <CrudForm<Values>
      {...identity}
      formVariant={scenario}
      entityId="form_policy_fixture:record"
      fields={fields}
      groups={crudFormSectionRuntime.sectionDescriptors.map(({ group }) => group)}
      sectionDescriptors={crudFormSectionRuntime.sectionDescriptors}
      sectionCustomFieldDefinitionSets={{ 'form_policy_fixture.region-v1': ['form_policy_fixture:record'] }}
      initialValues={{ name: '', displayName: '', privateCode: 'fixture-only', cf_region: region ?? 'north' }}
      onSubmit={onSubmit}
    />
  )
}
