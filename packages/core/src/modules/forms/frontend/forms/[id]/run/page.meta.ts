import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * In-app runner for a form addressed by its own id. Authenticated: both API
 * routes it calls (`/api/forms/:id/run/context` and `/run/submissions`) are
 * tenant-scoped, because a form id is not a capability a tenant handed out.
 * Anonymous runs belong on `/f/:slug` or `/i/:token`, which go through the
 * `/api/forms/public/*` lifecycle with its availability, cap, CAPTCHA and
 * rate-limit checks.
 */
export const metadata: PageMetadata = {
  requireAuth: true,
  titleKey: 'forms.runner.loading',
  title: 'Form',
}

export default metadata
