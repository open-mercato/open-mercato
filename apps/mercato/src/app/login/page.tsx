import { Suspense } from 'react'
import LoginPage from '@open-mercato/core/modules/auth/frontend/login'

export default function LoginRoutePage() {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  )
}
