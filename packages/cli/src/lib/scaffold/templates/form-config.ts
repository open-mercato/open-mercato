/**
 * components/formConfig.ts template (customers formConfig pattern: zod schema +
 * CrudField[] + groups from one place so create/detail can never disagree).
 */
export const formConfigTemplate = `import { z } from 'zod'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { {{entityCamel}}CreateSchema } from '../data/validators'

/** Entity id used to load custom-field sets once the module declares \`ce.ts\`. */
export const {{entityUpperSnake}}_ENTITY_ID = '{{moduleId}}:{{entitySnake}}'

export type {{entityPascal}}FormValues = z.infer<typeof {{entityCamel}}CreateSchema>

export function create{{entityPascal}}FormSchema() {
  return {{entityCamel}}CreateSchema
}

export function create{{entityPascal}}FormFields(t: TranslateFn): CrudField[] {
  return [
{{crudFields}}
  ]
}

export function create{{entityPascal}}FormGroups(t: TranslateFn): CrudFormGroup[] {
  return [
    {
      id: 'details',
      title: t('{{moduleId}}.form.groups.details', 'Details'),
      column: 1,
      fields: [{{fieldIdList}}],
    },
    // Custom-field sets registered for {{entityUpperSnake}}_ENTITY_ID render here.
    {
      id: 'attributes',
      title: t('{{moduleId}}.form.groups.attributes', 'Attributes'),
      column: 2,
      kind: 'customFields',
    },
  ]
}
`
