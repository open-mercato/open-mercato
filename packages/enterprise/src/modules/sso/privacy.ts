import { registerTenantExportExclusions } from '@open-mercato/shared/lib/privacy'

registerTenantExportExclusions({ module: 'sso', tables: ['scim_tokens'] })
