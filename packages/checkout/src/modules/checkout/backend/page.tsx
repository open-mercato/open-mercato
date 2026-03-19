import { redirect } from 'next/navigation'

export default function CheckoutBackendRootPage() {
  redirect('/backend/checkout/pay-links')
}
