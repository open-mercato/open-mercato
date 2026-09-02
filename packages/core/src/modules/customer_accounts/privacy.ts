import { registerTenantExportExclusions } from '@open-mercato/shared/lib/privacy'

registerTenantExportExclusions({
  module: 'customer_accounts',
  tables: [
    'customer_user_email_verifications',
    'customer_user_invitations',
    'customer_user_password_resets',
    'customer_user_sessions',
  ],
})
