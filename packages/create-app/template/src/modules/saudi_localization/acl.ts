export const features = [
  { id: 'saudi_localization.settings.view', title: 'View Saudi VAT settings', module: 'saudi_localization' },
  {
    id: 'saudi_localization.settings.manage',
    title: 'Manage Saudi VAT settings',
    module: 'saudi_localization',
    dependsOn: ['saudi_localization.settings.view'],
  },
]

export default features
