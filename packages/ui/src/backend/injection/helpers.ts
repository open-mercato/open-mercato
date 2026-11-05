import type { InjectionSpotId } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Generate a standard injection spot ID for CRUD forms
 * @param formName The name/identifier of the form (e.g., 'catalog.product', 'catalog.variant')
 * @returns A standardized injection spot ID
 */
export function generateCrudFormInjectionSpotId(formName: string): InjectionSpotId {
  return `crud-form:${formName}`
}

/**
 * Generate injection spot IDs for common CRUD form locations
 */
export const CrudFormInjectionSpots = {
  /**
   * Generate injection spot ID for before the form fields
   */
  beforeFields: (formName: string): InjectionSpotId => `${generateCrudFormInjectionSpotId(formName)}:before-fields`,
  
  /**
   * Generate injection spot ID for after the form fields
   */
  afterFields: (formName: string): InjectionSpotId => `${generateCrudFormInjectionSpotId(formName)}:after-fields`,
  
  /**
   * Generate injection spot ID for the header area
   */
  header: (formName: string): InjectionSpotId => `${generateCrudFormInjectionSpotId(formName)}:header`,
  
  /**
   * Generate injection spot ID for the footer/actions area
   */
  footer: (formName: string): InjectionSpotId => `${generateCrudFormInjectionSpotId(formName)}:footer`,
}
