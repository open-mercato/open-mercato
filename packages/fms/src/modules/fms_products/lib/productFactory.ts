import type { EntityManager } from '@mikro-orm/core'
import {
  BAFPieceProduct,
  BAFProduct,
  BOLProduct,
  ContainerVariant,
  CustomProduct,
  CustomsProduct,
  FmsChargeCode,
  FmsProduct,
  FmsProductVariant,
  FreightProduct,
  SimpleVariant,
  THCProduct,
} from '../data/entities.js'
import type { ProductType, VariantType } from '../data/types.js'

/**
 * Factory function to create product instances based on type
 * 
 * @param productType - The discriminator value for the product type
 * @returns A new instance of the appropriate product subclass
 * @throws Error if the product type is unknown
 * 
 * @example
 * const product = createProductInstance('GFRT')
 * product.loop = 'MSC SWAN'
 * product.source = 'SHA'
 * product.destination = 'GDN'
 */
export function createProductInstance(productType: ProductType): FmsProduct {
  switch (productType) {
    case 'GFRT':
      return new FreightProduct()
    case 'GTHC':
      return new THCProduct()
    case 'GCUS':
      return new CustomsProduct()
    case 'GBAF':
      return new BAFProduct()
    case 'GBAF_PIECE':
      return new BAFPieceProduct()
    case 'GBOL':
      return new BOLProduct()
    case 'CUSTOM':
      return new CustomProduct()
    default:
      throw new Error(`Unknown product type: ${productType}`)
  }
}

/**
 * Factory function to create variant instances based on type
 * 
 * @param variantType - The discriminator value for the variant type
 * @returns A new instance of the appropriate variant subclass
 * @throws Error if the variant type is unknown
 * 
 * @example
 * const variant = createVariantInstance('container')
 * variant.containerSize = '40HC'
 */
export function createVariantInstance(variantType: VariantType): FmsProductVariant {
  switch (variantType) {
    case 'container':
      return new ContainerVariant()
    case 'simple':
      return new SimpleVariant()
    default:
      throw new Error(`Unknown variant type: ${variantType}`)
  }
}

/**
 * Helper to determine product type from charge code
 * 
 * System charge codes map directly to product types.
 * Custom (non-system) charge codes use the CUSTOM product type.
 * 
 * @param em - EntityManager instance
 * @param chargeCodeId - UUID of the charge code
 * @returns The product type discriminator
 * @throws Error if charge code is not found
 * 
 * @example
 * const productType = await getProductTypeFromChargeCode(em, chargeCodeId)
 * const product = createProductInstance(productType)
 */
export async function getProductTypeFromChargeCode(
  em: EntityManager,
  chargeCodeId: string
): Promise<ProductType> {
  const chargeCode = await em.findOneOrFail(FmsChargeCode, { id: chargeCodeId })

  // System charge codes map directly to product types
  const systemTypes: ProductType[] = [
    'GFRT',
    'GBAF',
    'GBAF_PIECE',
    'GBOL',
    'GTHC',
    'GCUS',
  ]

  if (systemTypes.includes(chargeCode.code as ProductType)) {
    return chargeCode.code as ProductType
  }

  // Custom charge codes use CUSTOM product type
  return 'CUSTOM'
}

/**
 * Helper to determine variant type for a product instance
 * 
 * Freight and THC products use container variants.
 * All other products use simple variants.
 * 
 * @param product - Product instance
 * @returns The variant type discriminator
 * 
 * @example
 * const variantType = getVariantTypeForProduct(product)
 * const variant = createVariantInstance(variantType)
 */
export function getVariantTypeForProduct(product: FmsProduct): VariantType {
  return product instanceof FreightProduct || product instanceof THCProduct
    ? 'container'
    : 'simple'
}

/**
 * Helper to determine variant type from product type enum
 * 
 * Useful when you have the product type but not the instance.
 * 
 * @param productType - The product type discriminator
 * @returns The variant type discriminator
 * 
 * @example
 * const variantType = getVariantTypeFromProductType('GFRT')
 * // Returns 'container'
 */
export function getVariantTypeFromProductType(productType: ProductType): VariantType {
  return productType === 'GFRT' || productType === 'GTHC' ? 'container' : 'simple'
}
