import autoLinkCrm from './autoLinkCrm'

export const metadata = {
  event: 'customer_accounts.email.verified',
  persistent: true,
  id: 'customer_accounts:auto-link-crm-on-verification',
}

export default autoLinkCrm
