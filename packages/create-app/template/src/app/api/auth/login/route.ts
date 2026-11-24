import type { NextRequest } from 'next/server'
import { bootstrap } from '@/bootstrap-api'
import { POST as loginPost } from '@open-mercato/core/modules/auth/api/login'
import { admitRequest } from '@open-mercato/shared/lib/runtime/request-gate'
export { metadata, openApi } from '@open-mercato/core/modules/auth/api/login'

bootstrap()

export async function POST(req: NextRequest): Promise<Response> {
  const admission = await admitRequest({
    surface: 'api',
    method: 'POST',
    pathname: req.nextUrl.pathname,
    headers: req.headers,
    cookies: { get: (name: string) => req.cookies.get(name)?.value },
  })
  if (!admission.admitted) return admission.response
  try {
    return await loginPost(req)
  } finally {
    admission.release()
  }
}
