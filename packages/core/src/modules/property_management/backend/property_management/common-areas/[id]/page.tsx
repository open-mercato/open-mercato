import { CommonAreaForm } from '../../../../components/placement/CommonAreaForm'

export default function PropertyManagementCommonAreaEditPage({ params }: { params?: { id?: string } }) {
  return <CommonAreaForm commonAreaId={params?.id ?? ''} />
}
