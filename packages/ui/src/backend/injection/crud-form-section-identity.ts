import { resourceIdSchema, symbolicIdSchema } from '@open-mercato/shared/lib/crud/form-sections/protocol'
import type { CrudFormSectionAddress } from '@open-mercato/shared/modules/form-section-facts'
import type { CrudFormSectionConfiguredHostLedger } from '@open-mercato/shared/lib/crud/form-sections/composition'

export type CrudFormSectionIdentityProps = {
  /** Declared form variant used when the host has a section policy. */
  formVariant?: string
  /** Explicit operation for section policy lookup. */
  formOperation?: CrudFormSectionAddress['formOperation']
  /** Existing resource identifier. Required for update section policies. */
  resourceId?: string
}

export type CrudFormSectionIdentity = Pick<CrudFormSectionAddress, 'hostId' | 'formVariant'> & (
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

export function selectCrudFormSectionLedgerHost(
  ledger: CrudFormSectionConfiguredHostLedger | null,
  spotId: string | undefined,
  props: CrudFormSectionIdentityProps & { groups?: readonly unknown[] },
): string | null {
  const prefix = 'crud-form:'
  if (!ledger?.hosts.length || !spotId?.startsWith(prefix)) return null
  if (!props.groups?.length && props.formVariant === undefined && props.formOperation === undefined) return null
  const hostId = spotId.slice(prefix.length)
  return ledger.hosts.some((host) => host.hostId === hostId
    && (props.formVariant === undefined || props.formVariant === host.formVariant)
    && (props.formOperation === undefined || props.formOperation === host.formOperation))
    ? hostId : null
}
