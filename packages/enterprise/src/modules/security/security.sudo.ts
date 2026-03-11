import type { SecuritySudoTarget } from './lib/module-security-registry'

export const sudoTargets: SecuritySudoTarget[] = [
  {
    type: 'feature',
    identifier: 'security.sudo.manage',
    challengeMethod: 'auto',
  },
  {
    type: 'feature',
    identifier: 'security.admin.mfa.reset',
    challengeMethod: 'auto',
  },
]

export default sudoTargets
