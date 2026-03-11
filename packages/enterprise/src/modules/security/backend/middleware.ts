import { resolveMfaEnrollmentRedirect } from '../lib/enforcement-redirect'
import { resolveLegacyProfilePasswordRedirect } from '../lib/profile-password-integration'
import {
  CONTINUE_PAGE_MIDDLEWARE,
  type PageRouteMiddleware,
} from '@open-mercato/shared/modules/middleware/page'

export const middleware: PageRouteMiddleware[] = [
  {
    id: 'security.backend.legacy-profile-password-redirect',
    mode: 'backend',
    target: /^\/backend(?:\/auth\/profile|\/profile(?:\/change-password)?)\/?$/,
    priority: 10,
    run(context) {
      const location = resolveLegacyProfilePasswordRedirect(context.pathname)
      if (!location) return CONTINUE_PAGE_MIDDLEWARE
      return { action: 'redirect', location }
    },
  },
  {
    id: 'security.backend.mfa-enrollment-redirect',
    mode: 'backend',
    target: '/backend*',
    priority: 50,
    async run(context) {
      if (!context.routeMeta.requireAuth || !context.auth) return CONTINUE_PAGE_MIDDLEWARE
      const location = await resolveMfaEnrollmentRedirect({
        auth: context.auth,
        pathname: context.pathname,
        container: await context.ensureContainer(),
      })
      if (!location) return CONTINUE_PAGE_MIDDLEWARE
      return { action: 'redirect', location }
    },
  },
]

export default middleware
