import { createGusLookupWidget } from '../../../components/createGusLookupWidget'
import { applyCompanyToCustomersCompanyForm } from '../../../lib/mapping'
import { shouldRenderCompanyLookup } from '../../../lib/visibility'

/**
 * Built-in widget for the customers company create and edit forms (`companyForm`
 * host). Opt-in: rendered only when "Show on CRM company forms" is on and an
 * API key is set. The visibility rule keeps it off person forms even if a host
 * reuses the spot.
 */
const lookupWidget = createGusLookupWidget({
  id: 'gus_regon.injection.company-lookup',
  requiredModules: ['customers'],
  gate: 'companyForms',
  descriptionKey: 'gus_regon.widget.description',
  visible: ({ pathname, operation, values }) => shouldRenderCompanyLookup(pathname, operation, values),
  apply: (values, company, { t }) =>
    applyCompanyToCustomersCompanyForm(values, company, {
      addressLabel: t('gus_regon.lookup.addressLabel', 'Registered office (GUS)'),
    }),
})

/** Literal `metadata.id` so `yarn generate` can index the widget (it reads the id statically). */
const widget = {
  ...lookupWidget,
  metadata: { ...lookupWidget.metadata, id: 'gus_regon.injection.company-lookup' },
}

export default widget
