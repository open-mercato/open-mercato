"use client"

import { Building2 } from 'lucide-react'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { extensionPoints } from '../../extension-points'
import type { CompanyOverview, PersonOverview } from '../formConfig'

export const COMPANY_DETAIL_HEADER_AVATAR_COMPONENT_ID = extensionPoints.hosts.companyHeaderAvatar.componentId
export const PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID = extensionPoints.hosts.personHeaderAvatar.componentId

export type CompanyDetailHeaderAvatarProps = {
  data: CompanyOverview
  displayName: string
}

export type PersonDetailHeaderAvatarProps = {
  data: PersonOverview
  displayName: string
}

function DefaultCompanyDetailHeaderAvatar() {
  return <Avatar label="" icon={<Building2 />} size="xl" variant="monochrome" />
}

function DefaultPersonDetailHeaderAvatar({ displayName }: PersonDetailHeaderAvatarProps) {
  return <Avatar label={displayName} size="lg" variant="monochrome" />
}

registerComponent<CompanyDetailHeaderAvatarProps>({
  id: COMPANY_DETAIL_HEADER_AVATAR_COMPONENT_ID,
  component: DefaultCompanyDetailHeaderAvatar,
  metadata: { module: 'customers', description: 'Avatar in the company detail header.' },
})

registerComponent<PersonDetailHeaderAvatarProps>({
  id: PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID,
  component: DefaultPersonDetailHeaderAvatar,
  metadata: { module: 'customers', description: 'Avatar in the person detail header.' },
})

export function CompanyDetailHeaderAvatar(props: CompanyDetailHeaderAvatarProps) {
  const ResolvedAvatar = useRegisteredComponent<CompanyDetailHeaderAvatarProps>(
    COMPANY_DETAIL_HEADER_AVATAR_COMPONENT_ID,
    DefaultCompanyDetailHeaderAvatar,
  )
  return <ResolvedAvatar {...props} />
}

export function PersonDetailHeaderAvatar(props: PersonDetailHeaderAvatarProps) {
  const ResolvedAvatar = useRegisteredComponent<PersonDetailHeaderAvatarProps>(
    PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID,
    DefaultPersonDetailHeaderAvatar,
  )
  return <ResolvedAvatar {...props} />
}
