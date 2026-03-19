import { redirect } from 'next/navigation'

export default function CheckoutBackendRootPage() {
  return redirect('/backend/checkout/pay-links')
}
