import type { SecuritySudoTarget } from './lib/module-security-registry'

export const sudoTargets: SecuritySudoTarget[] = [
  {
    type: 'feature',
    identifier: 'security.sudo.manage',
    ttlSeconds: 300,
    challengeMethod: 'auto',
  },
  {
    type: 'feature',
    identifier: 'security.admin.mfa.reset',
    ttlSeconds: 300,
    challengeMethod: 'auto',
  },
]

export default sudoTargets
