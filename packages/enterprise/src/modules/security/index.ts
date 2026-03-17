import './commands/changePassword'
import './commands/createEnforcementPolicy'
import './commands/updateEnforcementPolicy'
import './commands/deleteEnforcementPolicy'
import './commands/removeMfaMethod'
import './commands/regenerateRecoveryCodes'
import './commands/resetUserMfa'
import './commands/createSudoConfig'
import './commands/updateSudoConfig'
import './commands/deleteSudoConfig'

export const metadata = {
  id: 'security',
  version: '0.1.0',
  enterprise: true,
  title: 'Security',
} as const

export { features } from './acl'
export {
  ChallengeMethod,
  SudoChallengeMethodUsed,
} from './data/constants'
export type {
  MfaProviderComponents,
  MfaProviderInterface,
  MfaProviderSetup,
  MfaProviderUser,
  MfaSetupComponentProps,
  MfaVerifyComponentProps,
} from './lib/mfa-provider-interface'
export type {
  SecurityMfaProviderEntry,
  SecuritySudoTarget,
  SecuritySudoTargetEntry,
} from './lib/module-security-registry'
export { requireSudo, SudoRequiredError, isSudoRequiredError } from './lib/sudo-middleware'
export { useSudoChallenge } from './components/hooks/useSudoChallenge'
export { SudoProvider, withSudoProtection } from './components/SudoProvider'
