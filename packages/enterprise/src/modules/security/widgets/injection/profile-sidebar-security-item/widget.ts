import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

const widgetModule: InjectionMenuItemWidget = {
  metadata: {
    id: 'security.injection.profile-sidebar-security-item',
    title: 'Security profile sidebar item',
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
      groupId: 'account',
    },
  ],
}

export default widgetModule
