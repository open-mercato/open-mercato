import { resolveMfaEnrollmentRedirect } from '../lib/enforcement-redirect'
import {
  CONTINUE_PAGE_MIDDLEWARE,
  type PageRouteMiddleware,
} from '@open-mercato/shared/modules/middleware/page'

export const middleware: PageRouteMiddleware[] = [
  {
    id: 'security.frontend.mfa-enrollment-redirect',
    mode: 'frontend',
    target: '/*',
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
