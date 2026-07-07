import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'

// The home route is a pure router: it never renders. Unless the visitor has
// dismissed the start page, it sends them there; otherwise into the app
// (backend when authenticated, login otherwise).
export default async function Home() {
  const cookieStore = await cookies()
  const startPageDismissed = cookieStore.get('start_page_dismissed')?.value === '1'

  if (!startPageDismissed) {
    redirect('/start')
  }

  const auth = await getAuthFromCookies()
  redirect(auth ? '/backend' : '/login')
}
