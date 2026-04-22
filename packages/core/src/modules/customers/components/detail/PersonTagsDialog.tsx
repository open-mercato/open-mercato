'use client'

import { EntityTagsDialog, type EntityTagsDialogProps } from './EntityTagsDialog'

type PersonTagsDialogProps = Omit<EntityTagsDialogProps, 'entityId' | 'entityType' | 'entityOrganizationId' | 'entityData'> & {
  personId: string
  personOrganizationId: string | null
  personData: EntityTagsDialogProps['entityData']
}

export function PersonTagsDialog({
  personId,
  personOrganizationId,
  personData,
  ...props
}: PersonTagsDialogProps) {
  return (
    <EntityTagsDialog
      {...props}
      entityId={personId}
      entityType="person"
      entityOrganizationId={personOrganizationId}
      entityData={personData}
    />
  )
}
