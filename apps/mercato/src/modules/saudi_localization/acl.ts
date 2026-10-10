/**
 * The module's features.
 *
 * Every tax-reporting grant depends on `settings.view` rather than on the write
 * grant: a VAT return is read from the same seller identity the settings screen
 * shows, and an operator who may not edit the identity can still be the one who
 * files from it. Issuance is separate again — it is the only grant here that
 * causes an external, irreversible act.
 */
export const features = [
  { id: 'saudi_localization.settings.view', title: 'View Saudi VAT settings', module: 'saudi_localization' },
  {
    id: 'saudi_localization.settings.manage',
    title: 'Manage Saudi VAT settings',
    module: 'saudi_localization',
    dependsOn: ['saudi_localization.settings.view'],
  },
  {
    id: 'saudi_localization.vat_return.view',
    title: 'View the Saudi VAT return',
    module: 'saudi_localization',
    dependsOn: ['saudi_localization.settings.view'],
  },
  {
    id: 'saudi_localization.withholding.view',
    title: 'View Saudi withholding tax',
    module: 'saudi_localization',
    dependsOn: ['saudi_localization.settings.view'],
  },
  {
    id: 'saudi_localization.zakat.view',
    title: 'View the Saudi zakat base',
    module: 'saudi_localization',
    dependsOn: ['saudi_localization.settings.view'],
  },
  {
    id: 'saudi_localization.einvoicing.issue',
    title: 'Issue ZATCA e-invoices',
    module: 'saudi_localization',
    dependsOn: ['saudi_localization.settings.view'],
  },
]

export default features
