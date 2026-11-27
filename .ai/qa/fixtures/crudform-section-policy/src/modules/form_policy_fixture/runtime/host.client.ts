import { defineCrudFormSectionRuntime } from '@open-mercato/ui/backend/injection/crud-form-section-runtime'

const details = defineCrudFormSectionRuntime<Record<string, unknown>, unknown, Record<string, unknown>>({
  id: 'form_policy_fixture.base-details', roundTripId: 'form_policy_fixture.base-details@v1',
  group: { id: 'details', fields: ['name'] },
  ownedFieldPaths: ['name'],
  validate: ({ sectionValues }) => ({ success: true, data: sectionValues.name }),
  projectPayload: (name) => ({ name }),
})

const privateSection = defineCrudFormSectionRuntime<Record<string, unknown>, unknown, Record<string, unknown>>({
  id: 'form_policy_fixture.base-private', roundTripId: 'form_policy_fixture.base-private@v1',
  group: { id: 'private', fields: ['privateCode'] },
  ownedFieldPaths: ['privateCode'],
  validate: ({ sectionValues }) => ({ success: true, data: sectionValues.privateCode }),
  projectPayload: (privateCode) => ({ privateCode }),
})

export const crudFormSectionRuntime = {
  id: 'form_policy_fixture.record-host',
  roundTripId: 'form_policy_fixture.record-host@v1',
  sectionDescriptors: [details, privateSection],
}
