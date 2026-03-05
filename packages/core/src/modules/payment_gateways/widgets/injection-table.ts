import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Keep hub module free of cross-module UI bindings.
 * Consumer modules should map their own spots to payment_gateway widgets.
 */
export const injectionTable: ModuleInjectionTable = {}

export default injectionTable
