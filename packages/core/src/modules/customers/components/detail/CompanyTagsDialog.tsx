'use client'

import { EntityTagsDialog, type EntityTagsDialogProps } from './EntityTagsDialog'

type CompanyTagsDialogProps = Omit<EntityTagsDialogProps, 'entityType' | 'entityOrganizationId' | 'entityData'> & {
  companyOrganizationId: string | null
  companyData: EntityTagsDialogProps['entityData']
}

export function CompanyTagsDialog({
  companyOrganizationId,
  companyData,
  ...props
}: CompanyTagsDialogProps) {
  return (
    <EntityTagsDialog
      {...props}
      entityType="company"
      entityOrganizationId={companyOrganizationId}
      entityData={companyData}
    />
  )
}
