import { FloorPlanPage } from '../../../components/floorPlan/FloorPlanPage'
import { localToday } from '../../../lib/leaseTerm'

export default function PropertyManagementFloorPlanPage() {
  return <FloorPlanPage today={localToday()} />
}
