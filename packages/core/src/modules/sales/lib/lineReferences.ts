import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export type LineReferenceConflict = 'service_on_non_service_line' | 'product_on_service_line'

type LineReferenceFields = {
  kind?: string | null
  productId?: string | null
  productVariantId?: string | null
  serviceId?: string | null
}

export function findLineReferenceConflict(line: LineReferenceFields): LineReferenceConflict | null {
  const kind = line.kind ?? 'product'
  if (line.serviceId && kind !== 'service') return 'service_on_non_service_line'
  if (kind === 'service' && (line.productId || line.productVariantId)) return 'product_on_service_line'
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
            'sales.errors.serviceLineCannotReferenceProduct',
            'Line {{line}} is a service line and cannot reference a product or variant.',
            { line: String(lineNumber) },
          ),
  })
}
