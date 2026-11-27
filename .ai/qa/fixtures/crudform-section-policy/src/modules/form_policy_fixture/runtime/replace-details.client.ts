import { z } from 'zod'
import { defineCrudFormSectionRuntime } from '@open-mercato/ui/backend/injection/crud-form-section-runtime'

const sectionSchema = z.object({
  displayName: z.string().trim().min(1),
  cf_region: z.string().trim().min(1),
})
type ParsedSection = z.infer<typeof sectionSchema>

export const crudFormSectionRuntime = defineCrudFormSectionRuntime<Record<string, unknown>, ParsedSection, Record<string, unknown>>({
  id: 'form_policy_fixture.replace-details', roundTripId: 'form_policy_fixture.replace-details@v1',
  group: { id: 'details', fields: ['displayName'] },
  ownedFieldPaths: ['displayName'],
  ownedCustomFieldIds: ['region'],
  customFieldDefinitionSetId: 'form_policy_fixture.region-v1',
  validate: ({ sectionValues }) => {
    const parsed = sectionSchema.safeParse(sectionValues)
    return parsed.success ? { success: true, data: parsed.data }
      : { success: false, fieldErrors: { displayName: 'form_policy_fixture.validation.name' } }
  },
  projectPayload: ({ displayName, cf_region }) => ({ name: displayName, customFields: { region: cf_region } }),
})
