import { notFound } from 'next/navigation'
import { RestaurantOpsDemo } from '@/modules/restaurant_ops/components/RestaurantOpsDemo'
import { restaurantSeed } from '@/modules/restaurant_ops/lib/demo-data'

export default async function RestaurantTablePage({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params
  const table = restaurantSeed.tables.find((entry) => entry.id === tableId)

  if (!table) {
    notFound()
  }

  return <RestaurantOpsDemo initialTableId={tableId} />
}
