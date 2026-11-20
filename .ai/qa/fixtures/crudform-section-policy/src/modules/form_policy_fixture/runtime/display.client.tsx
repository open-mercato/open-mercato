'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { defineCrudFormSectionRuntime } from '@open-mercato/ui/backend/injection/crud-form-section-runtime'

function PolicyDisplay() {
  const t = useT()
  return <p>{t('form_policy_fixture.display')}</p>
}

export const crudFormSectionRuntime = defineCrudFormSectionRuntime({
  id: 'form_policy_fixture.display', roundTripId: 'form_policy_fixture.display@v1',
  group: { id: 'display', component: () => <PolicyDisplay /> },
  ownedFieldPaths: [],
  validate: () => ({ success: true, data: null }),
  projectPayload: () => ({}),
})
