import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Example module injection table
 * Maps injection spot IDs to widget IDs for automatic widget injection
 */
export const injectionTable: ModuleInjectionTable = {
  // Inject the validation widget into the catalog product CRUD form
  'crud-form:catalog.product': 'example.injection.crud-validation',
  
  // Can also inject into variant form
  'crud-form:catalog.variant': 'example.injection.crud-validation',
}

export default injectionTable
