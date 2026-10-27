import { FloorSetupPage } from '../../../../../../components/floor/FloorSetupPage'

export default function PropertyManagementFloorPage({ params }: { params?: { id?: string; floorId?: string } }) {
  return <FloorSetupPage buildingId={params?.id ?? ''} floorId={params?.floorId ?? ''} />
}
