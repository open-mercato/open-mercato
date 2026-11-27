import { defineCrudFormSectionRuntime } from '@open-mercato/ui/backend/injection/crud-form-section-runtime'

export const crudFormSectionRuntime = defineCrudFormSectionRuntime({
  id: 'form_policy_fixture.showcase.display', roundTripId: 'form_policy_fixture.showcase.display@v1',
  group: { id: 'display', title: 'form_policy_fixture.display', fields: [] },
  ownedFieldPaths: [],
  validate: () => ({ success: true, data: null }),
  projectPayload: () => ({}),
})
