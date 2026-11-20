import { resourceIdSchema, symbolicIdSchema } from '@open-mercato/shared/lib/crud/form-sections/protocol'
import type { CrudFormSectionAddress } from '@open-mercato/shared/modules/form-section-facts'

export type CrudFormSectionIdentityProps = {
  /** Declared form variant used when the host has a section policy. */
  formVariant?: string
  /** Explicit operation for section policy lookup. */
  formOperation?: CrudFormSectionAddress['formOperation']
  /** Existing resource identifier. Required for update section policies. */
  resourceId?: string
}

type CrudFormSectionIdentity = Pick<CrudFormSectionAddress, 'hostId' | 'formVariant'> & (
  | { formOperation: 'create'; resourceId?: never }
  | { formOperation: 'update'; resourceId: string }
)

export function readExplicitCrudFormSectionIdentity(
  hostId: string,
  { formVariant, formOperation, resourceId }: CrudFormSectionIdentityProps,
): CrudFormSectionIdentity | null {
  if (!symbolicIdSchema.safeParse(hostId).success || formVariant === undefined
      || !symbolicIdSchema.safeParse(formVariant).success) return null

  if (formOperation === 'create' && resourceId === undefined) return { hostId, formVariant, formOperation }
  if (formOperation === 'update' && resourceId !== undefined && resourceIdSchema.safeParse(resourceId).success) {
    return { hostId, formVariant, formOperation, resourceId }
  }
  return null
}
