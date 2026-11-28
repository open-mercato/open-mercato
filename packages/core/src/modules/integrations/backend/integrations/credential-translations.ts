import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { IntegrationCredentialField } from '@open-mercato/shared/modules/integrations/types'

export function translateCredentialFields(
  fields: IntegrationCredentialField[],
  schemaId: string,
  t: TranslateFn,
): IntegrationCredentialField[] {
  return fields.map((field) => {
    const prefix = `${schemaId}.credentials.${field.key}`
    let translated = {
      ...field,
      label: t(`${prefix}.label`, field.label),
      ...(field.helpText ? { helpText: t(`${prefix}.helpText`, field.helpText) } : {}),
      ...(field.placeholder ? { placeholder: t(`${prefix}.placeholder`, field.placeholder) } : {}),
    }
    if (field.helpDetails) {
      const guide = field.helpDetails
      translated = {
        ...translated,
        helpDetails: {
          ...guide,
          title: t(`${prefix}.helpDetails.title`, guide.title),
          summary: t(`${prefix}.helpDetails.summary`, guide.summary),
          dashboardPathLabel: t(`${prefix}.helpDetails.dashboardPathLabel`, guide.dashboardPathLabel),
          steps: guide.steps.map((step, index) => t(`${prefix}.helpDetails.steps.${index}`, step)),
          ...(guide.localDevelopment ? {
            localDevelopment: {
              ...guide.localDevelopment,
              ...(guide.localDevelopment.note ? {
                note: t(`${prefix}.helpDetails.localDevelopment.note`, guide.localDevelopment.note),
              } : {}),
            },
          } : {}),
        },
      }
    }
    if (field.type === 'select') {
      return {
        ...translated,
        type: field.type,
        options: field.options.map((option) => ({
          ...option,
          label: t(`${prefix}.options.${option.value}`, option.label),
        })),
      }
    }
    return translated
  })
}
