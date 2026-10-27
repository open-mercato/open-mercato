import BuildingEditPage from '../../../../components/buildings/BuildingEditPage'

export default function PropertyManagementBuildingEditPage({ params }: { params?: { id?: string } }) {
  return <BuildingEditPage buildingId={params?.id ?? ''} />
}
