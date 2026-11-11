import { redirect } from 'next/navigation'

export default function WmsReceivingPage() {
  redirect('/backend/wms/asns?queue=open')
}
