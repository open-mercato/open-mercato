import { registerTenantExportExclusions } from '@open-mercato/shared/lib/privacy'

registerTenantExportExclusions({ module: 'communication_channels', tables: ['channel_thread_tokens'] })
