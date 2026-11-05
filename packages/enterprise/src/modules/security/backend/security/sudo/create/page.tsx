import { readSecurityModuleConfig } from '../../../../lib/security-config'
import SudoConfigCrudPage from '../../../../components/SudoConfigCrudPage'

export default function CreateSudoRulePage() {
  const securityConfig = readSecurityModuleConfig()

  return (
    <SudoConfigCrudPage
      mode="create"
      defaultTtlSeconds={securityConfig.sudo.defaultTtlSeconds}
      maxTtlSeconds={securityConfig.sudo.maxTtlSeconds}
    />
  )
}
