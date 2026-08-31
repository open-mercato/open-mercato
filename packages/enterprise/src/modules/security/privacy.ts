import { registerTenantExportExclusions } from '@open-mercato/shared/lib/privacy'

registerTenantExportExclusions({ module: 'security', tables: ['sudo_sessions'] })
