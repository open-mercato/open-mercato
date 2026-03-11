import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  SECURITY_PROFILE_PATH,
  isLegacySelfPasswordChangeAttempt,
} from '../lib/profile-password-integration'

export const interceptors: CommandInterceptor[] = [
  {
    id: 'security.block-legacy-self-password-change',
    targetCommand: 'auth.users.update',
    priority: 10,
    async beforeExecute(input, context) {
      if (!isLegacySelfPasswordChangeAttempt(input, context.auth?.sub ?? null)) return

      const { translate } = await resolveTranslations()
      throw new CrudHttpError(400, {
        error: translate(
          'security.profile.password.form.errors.useSecurityPage',
          'Password changes must be made from the Security & MFA page.',
        ),
        redirectTo: SECURITY_PROFILE_PATH,
      })
    },
  },
]

export default interceptors
