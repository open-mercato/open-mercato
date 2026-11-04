// Idempotent, worker-dispatched backstop for `seed-organization-encryption-maps.ts`. That
// sibling subscriber is `persistent: false` so it seeds the new organization's maps inline,
// before the `directory.organizations.create` request returns — but an inline handler error
// is logged and swallowed with no retry of its own (packages/events/AGENTS.md § Persistent
// delivery: single-delivery, "Failure on the inline path"). This subscriber is the retry: it
// runs the same upsert through the queue, so a transient inline failure (DB hiccup, cache
// backend down) still ends with the organization's maps seeded. Re-running it is always safe —
// `upsertEncryptionMapSpecs` upserts on the existing partial unique index.

import handle, { type ResolverContext } from '@open-mercato/core/modules/entities/subscribers/seed-organization-encryption-maps'

export const metadata = {
  event: 'directory.organization.created',
  persistent: true,
  id: 'entities:seed-organization-encryption-maps-retry',
}

export default function retryHandle(payload: unknown, ctx: ResolverContext): Promise<void> {
  return handle(payload, ctx)
}
