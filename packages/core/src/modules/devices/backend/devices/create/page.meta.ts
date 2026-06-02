export const metadata = {
  requireAuth: true,
  requireFeatures: ['devices.admin'],
  pageTitle: 'Register device',
  pageTitleKey: 'devices.form.createTitle',
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Devices', labelKey: 'devices.nav.devices', href: '/backend/devices' },
    { label: 'Register device', labelKey: 'devices.form.createTitle' },
  ],
}
