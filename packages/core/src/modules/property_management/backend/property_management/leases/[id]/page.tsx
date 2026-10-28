import LeaseDetailPage from '../../../../components/leases/LeaseDetailPage'

export default function PropertyManagementLeaseDetailPage({ params }: { params?: { id?: string } }) {
  return <LeaseDetailPage leaseId={params?.id ?? ''} />
}
