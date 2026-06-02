import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { pushRegister } from './push-register'

/**
 * Spec C § Phase C4 — Renew a push registration.
 *
 * The renewal action is to call the same `registerPush` adapter method again —
 * Gmail's `users.watch` is idempotent (it returns a fresh `expiration` and
 * `historyId`).
 *
 * Callers: the daily renewal cron worker (`gmail-renew-watch.ts`). The
 * operator-facing `POST /push/register` route invokes `pushRegister` directly
 * without needing this helper.
 */

export const pushRenewSchema = z.object({
  channelId: z.string().uuid(),
})

export interface PushRenewScope {
  tenantId: string
  organizationId: string
  userId?: string | null
}

export interface PushRenewResult {
  channelId: string
  pushStatus: 'active' | 'failed'
  error?: { code: string; message: string }
}

export async function pushRenew(params: {
  container: AwilixContainer
  scope: PushRenewScope
  input: { channelId: string }
}): Promise<PushRenewResult> {
  const input = pushRenewSchema.parse(params.input)
  const result = await pushRegister({
    container: params.container,
    scope: params.scope,
    input: { channelId: input.channelId },
  })
  return {
    channelId: result.channelId,
    pushStatus: result.pushStatus,
    error: result.error,
  }
}
