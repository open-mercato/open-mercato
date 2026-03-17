import type { SecuritySudoTarget } from './lib/module-security-registry'

export const sudoTargets: SecuritySudoTarget[] = [
  {
    identifier: 'security.sudo.manage',
    challengeMethod: 'auto',
  },
  {
    identifier: 'security.admin.mfa.reset',
    challengeMethod: 'auto',
  },
]

export default sudoTargets
