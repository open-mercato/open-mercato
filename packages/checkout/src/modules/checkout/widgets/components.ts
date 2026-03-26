import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'

/**
 * Component replacement handles exposed by the checkout module.
 *
 * These handles allow other modules (or user-app code) to replace, wrap,
 * or override props on checkout UI components via UMES.
 *
 * Available handles:
 *
 * Pages:
 *   page:checkout.pay-page
 *   page:checkout.success-page
 *   page:checkout.error-page
 *
 * Pay Page Sections:
 *   section:checkout.pay-page.header
 *   section:checkout.pay-page.description
 *   section:checkout.pay-page.summary
 *   section:checkout.pay-page.pricing
 *   section:checkout.pay-page.payment
 *   section:checkout.pay-page.customer-form
 *   section:checkout.pay-page.legal-consent
 *   section:checkout.pay-page.gateway-form
 *   section:checkout.pay-page.help
 *   section:checkout.pay-page.footer
 *
 * Result Page Sections:
 *   section:checkout.success-page.content
 *   section:checkout.error-page.content
 *
 * CRUD Forms:
 *   crud-form:checkout:link
 *   crud-form:checkout:template
 *
 * Data Tables:
 *   data-table:checkout-links
 *   data-table:checkout-templates
 *   data-table:checkout-transactions
 */
export const componentOverrides: ComponentOverride[] = []

export default componentOverrides
