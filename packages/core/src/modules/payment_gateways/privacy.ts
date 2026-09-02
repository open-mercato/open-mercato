import { registerTenantExportExclusions } from '@open-mercato/shared/lib/privacy'

registerTenantExportExclusions({ module: 'payment_gateways', tables: ['gateway_session_initializations'] })
