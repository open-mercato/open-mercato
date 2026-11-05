import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { isAutoLoginEnabled } from '@open-mercato/core/modules/auth/lib/autologin'

// The home route is a pure router: it never renders. Unless the visitor has
// dismissed the start page, it sends them there; otherwise into the app
// (backend when authenticated, login otherwise).
export default async function Home() {
  const auth = await getAuthFromCookies()

  // Demo autologin: when OM_AUTOLOGIN_* credentials are configured and there is
  // no active session, hand off to the autologin route which signs the visitor
  // in and drops them into the app. Fully gated behind env vars — with them
  // unset, behavior below is unchanged. The route falls back to /login when the
  // credentials are invalid, so a misconfigured demo can never loop.
  if (!auth && isAutoLoginEnabled()) {
    redirect('/api/auth/autologin')
  }

  const cookieStore = await cookies()
  const startPageDismissed = cookieStore.get('start_page_dismissed')?.value === '1'

  if (!startPageDismissed) {
    redirect('/start')
  }

  redirect(auth ? '/backend' : '/login')
}
