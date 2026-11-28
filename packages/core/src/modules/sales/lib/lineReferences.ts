import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export type LineReferenceConflict = 'service_on_non_service_line' | 'service_and_product_reference'

type LineReferenceFields = {
  kind?: string | null
  productId?: string | null
  productVariantId?: string | null
  serviceId?: string | null
}

export function findLineReferenceConflict(line: LineReferenceFields): LineReferenceConflict | null {
  if (!line.serviceId) return null
  if ((line.kind ?? 'product') !== 'service') return 'service_on_non_service_line'
  if (line.productId || line.productVariantId) return 'service_and_product_reference'
  return null
}

export async function assertLineReferencesConsistent(
  line: LineReferenceFields,
  lineNumber: number,
): Promise<void> {
  const conflict = findLineReferenceConflict(line)
  if (!conflict) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(400, {
    error:
      conflict === 'service_on_non_service_line'
        ? translate(
            'sales.errors.serviceReferenceRequiresServiceKind',
            'Line {{line}} references a service but is not a service line.',
            { line: String(lineNumber) },
          )
        : translate(
            'sales.errors.serviceAndProductReference',
            'Line {{line}} cannot reference both a service and a product or variant.',
            { line: String(lineNumber) },
          ),
  })
}
