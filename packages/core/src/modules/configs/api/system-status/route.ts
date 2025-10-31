import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { buildSystemStatusSnapshot } from '../../lib/system-status'
import type { SystemStatusSnapshot } from '../../lib/system-status.types'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['configs.system_status.view'] },
} as const

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const snapshot: SystemStatusSnapshot = buildSystemStatusSnapshot()
    return NextResponse.json(snapshot)
  } catch (error) {
    console.error('[configs.system-status] failed to build environment snapshot', error)
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('configs.systemStatus.error', 'Failed to load system status') },
      { status: 500 }
    )
  }
}
