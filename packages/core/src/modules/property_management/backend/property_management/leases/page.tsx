import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import LeasesListPage from '../../../components/leases/LeasesListPage'

export default async function PropertyManagementLeasesPage() {
  const container = await createRequestContainer()
  const registry = container as { hasRegistration?: (name: string) => boolean }
  const schedulerAvailable = typeof registry.hasRegistration === 'function' && registry.hasRegistration('schedulerService')
  return <LeasesListPage schedulerAvailable={schedulerAvailable} />
}
