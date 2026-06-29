import { Suspense } from 'react'
import LoginPage from '@open-mercato/core/modules/auth/frontend/login'

export default function LoginRoutePage() {
  return (
    // LoginPage reads query params with useSearchParams; keep this boundary so
    // static builds can prerender the route and hydrate the client-only params.
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  )
}
