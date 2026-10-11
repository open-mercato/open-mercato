import { defineSimulateConfig } from '@open-mercato/shared/modules/insights/simulate'
import { roleAclPreviewKind } from './lib/simulation/roleAclPreview'

/**
 * Change simulator contribution of auth: the role permission preview (`auth.role_acl_preview`)
 * shows which users and API keys would gain or lose access if a role's ACL were saved, computed
 * inline from the current roles, users and API keys without changing anything.
 */
export const simulateConfig = defineSimulateConfig({
  version: 1,
  kinds: [roleAclPreviewKind],
})

export default simulateConfig
