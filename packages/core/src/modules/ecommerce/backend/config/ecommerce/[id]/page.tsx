import { StoreEditPage } from '../../../../components/StoreEditPage'

export default function EcommerceStoreEditPage({ params }: { params?: { id?: string } }) {
  return <StoreEditPage storeId={params?.id} />
}
