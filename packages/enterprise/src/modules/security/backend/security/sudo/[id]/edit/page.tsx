import { readSecurityModuleConfig } from '../../../../../lib/security-config'
import SudoConfigCrudPage from '../../../../../components/SudoConfigCrudPage'

export default function EditSudoRulePage({ params }: { params?: { id?: string } }) {
  const securityConfig = readSecurityModuleConfig()

  return (
    <SudoConfigCrudPage
      mode="edit"
      id={params?.id}
      defaultTtlSeconds={securityConfig.sudo.defaultTtlSeconds}
      maxTtlSeconds={securityConfig.sudo.maxTtlSeconds}
    />
  )
}
