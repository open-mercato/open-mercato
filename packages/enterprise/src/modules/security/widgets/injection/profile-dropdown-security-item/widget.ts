import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

const widgetModule: InjectionMenuItemWidget = {
  metadata: {
    id: 'security.injection.profile-dropdown-security-item',
    title: 'Security profile menu item',
    priority: 500,
    enabled: true,
  },
  menuItems: [
    {
      id: 'security-profile-security-mfa',
      labelKey: 'security.menu.profile.securityMfa',
      label: 'Security & MFA',
      icon: 'ShieldCheck',
      href: '/backend/profile/security',
      features: ['security.profile.view'],
      placement: { position: InjectionPosition.Before, relativeTo: 'sign-out' },
    },
  ],
}

export default widgetModule
