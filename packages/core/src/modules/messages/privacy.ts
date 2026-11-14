import { registerTenantExportExclusions } from '@open-mercato/shared/lib/privacy'

registerTenantExportExclusions({ module: 'messages', tables: ['message_access_tokens'] })
