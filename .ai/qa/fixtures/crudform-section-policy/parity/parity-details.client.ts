import { z } from 'zod'
import {
  defineCrudFormSectionRuntime, type CrudFormSectionRuntimeDescriptor,
} from '@open-mercato/ui/backend/injection/crud-form-section-runtime'

const sectionSchema = z.object({
  displayName: z.string().trim().min(1),
  cf_region: z.string().trim().min(1),
})
type Values = Record<string, unknown>
type Parsed = z.infer<typeof sectionSchema>

export const crudFormSectionRuntime = defineCrudFormSectionRuntime<Values, Parsed, Values>({
  id: 'form_policy_fixture.showcase.details', roundTripId: 'form_policy_fixture.showcase.details@v1',
  group: { id: 'details', fields: ['displayName'] },
  ownedFieldPaths: ['displayName'],
  ownedPayloadPaths: ['name'],
  ownedCustomFieldIds: ['region'],
  customFieldDefinitionSetId: 'form_policy_fixture.region-v1',
  validate: ({ sectionValues }) => {
    const parsed = sectionSchema.safeParse(sectionValues)
    return parsed.success ? { success: true, data: parsed.data }
      : { success: false, fieldErrors: { displayName: 'form_policy_fixture.validation.name' } }
  },
  projectPayload: ({ displayName, cf_region }) => ({ name: displayName, customFields: { region: cf_region } }),
} as CrudFormSectionRuntimeDescriptor<Values, Parsed, Values> & { ownedPayloadPaths: readonly string[] })
