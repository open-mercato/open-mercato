import { Suspense } from 'react'
import LoginPage from '@open-mercato/core/modules/auth/frontend/login'

export default function LoginRoutePage() {
  return (
    // LoginPage reads query params with useSearchParams; keep this boundary so
    // static builds can prerender the route and hydrate the client-only params.
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </div>
    }>
      <LoginPage />
    </Suspense>
  )
}
