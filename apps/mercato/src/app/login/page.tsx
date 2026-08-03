import { Suspense } from 'react'
import LoginPage from '@open-mercato/core/modules/auth/frontend/login'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export default function LoginRoutePage() {
  return (
    // LoginPage reads query params with useSearchParams; keep this boundary so
    // static builds can prerender the route and hydrate the client-only params.
    <Suspense
      fallback={(
        <div className="flex min-h-screen items-center justify-center">
          <Spinner size="lg" />
        </div>
      )}
    >
      <LoginPage />
    </Suspense>
  )
}
