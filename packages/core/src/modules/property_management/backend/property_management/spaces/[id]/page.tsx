import { SpaceForm } from '../../../../components/placement/SpaceForm'

export default function PropertyManagementSpaceEditPage({ params }: { params?: { id?: string } }) {
  return <SpaceForm spaceId={params?.id ?? ''} />
}
