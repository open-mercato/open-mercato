import { UnitForm } from '../../../../components/placement/UnitForm'

export default function PropertyManagementUnitEditPage({ params }: { params?: { id?: string } }) {
  return <UnitForm unitId={params?.id ?? ''} />
}
