import {
  dedupeStrings,
  labelFromLocalizedRecord,
  type AkeneoAttribute,
  type AkeneoCustomFieldKind,
  type AkeneoCustomFieldMapping,
  type AkeneoFamily,
  type AkeneoFamilyVariant,
  type AkeneoMediaMapping,
  type AkeneoProductFieldKey,
} from './shared'

type InferAkeneoProductMappingInput = {
  attributes: AkeneoAttribute[]
  family: AkeneoFamily | null
  familyVariant: AkeneoFamilyVariant | null
  fieldMap: Record<AkeneoProductFieldKey, string>
  explicitCustomFieldMappings: AkeneoCustomFieldMapping[]
  explicitMediaMappings: AkeneoMediaMapping[]
}

type InferAkeneoProductMappingResult = {
  axisCodes: string[]
  variantAttributeCodes: string[]
  optionSchemaAttributeCodes: string[]
  fieldMap: Record<AkeneoProductFieldKey, string>
  autoCustomFieldMappings: AkeneoCustomFieldMapping[]
  autoMediaMappings: AkeneoMediaMapping[]
  autoPriceAttributeCodes: string[]
}

const FIELD_CANDIDATES: Record<Exclude<AkeneoProductFieldKey, 'sku'>, string[]> = {
  title: ['name', 'title', 'label', 'product name', 'product title'],
  subtitle: ['subtitle', 'sub title', 'short title', 'tagline'],
  description: ['description', 'long description', 'short description', 'details'],
  barcode: ['ean', 'barcode', 'gtin', 'upc', 'isbn'],
  weight: ['weight', 'shipping weight'],
  variantName: ['variant name', 'name', 'label', 'title'],
}

function normalizeLookupToken(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function inferCustomFieldKind(attribute: AkeneoAttribute): AkeneoCustomFieldKind | null {
  if (attribute.type === 'pim_catalog_boolean') return 'boolean'
  if (attribute.type === 'pim_catalog_number') {
    return attribute.decimals_allowed === false ? 'integer' : 'float'
  }
  if (attribute.type === 'pim_catalog_metric') return 'float'
  if (
    attribute.type === 'pim_catalog_simpleselect'
    || attribute.type === 'pim_catalog_multiselect'
    || attribute.type === 'akeneo_reference_entity'
    || attribute.type === 'akeneo_reference_entity_collection'
  ) {
    return 'select'
  }
  if (attribute.type === 'pim_catalog_textarea') return 'multiline'
  if (attribute.type === 'pim_catalog_text' || attribute.type === 'pim_catalog_date') return 'text'
  return null
}

function isMediaAttributeType(type: string): boolean {
  return type === 'pim_catalog_image' || type === 'pim_catalog_file'
}

function isImageAttributeType(type: string): boolean {
  return type === 'pim_catalog_image'
}

function matchesTextFieldType(key: AkeneoProductFieldKey, attribute: AkeneoAttribute): boolean {
  if (key === 'description') {
    return attribute.type === 'pim_catalog_text' || attribute.type === 'pim_catalog_textarea'
  }
  if (key === 'weight') {
    return attribute.type === 'pim_catalog_metric' || attribute.type === 'pim_catalog_number'
  }
  if (key === 'barcode') {
    return attribute.type === 'pim_catalog_text' || attribute.type === 'pim_catalog_number'
  }
  return attribute.type === 'pim_catalog_text' || attribute.type === 'pim_catalog_textarea'
}

function scoreAttributeForField(
  key: Exclude<AkeneoProductFieldKey, 'sku'>,
  attribute: AkeneoAttribute,
  candidates: string[],
): number {
  const codeToken = normalizeLookupToken(attribute.code)
  const labelToken = normalizeLookupToken(labelFromLocalizedRecord(attribute.labels ?? null, null, attribute.code))
  let score = matchesTextFieldType(key, attribute) ? 20 : 0
  for (const candidate of candidates) {
    const token = normalizeLookupToken(candidate)
    if (!token) continue
    if (codeToken === token) score = Math.max(score, 120)
    else if (codeToken.startsWith(token)) score = Math.max(score, 100)
    else if (codeToken.includes(token)) score = Math.max(score, 80)
    if (labelToken === token) score = Math.max(score, 90)
    else if (labelToken.includes(token)) score = Math.max(score, 70)
  }
  return score
}

function pickFieldAttributeCode(
  key: Exclude<AkeneoProductFieldKey, 'sku'>,
  attributes: AkeneoAttribute[],
  preferredCode: string | null | undefined,
  extraCandidates: string[] = [],
): string {
  const current = typeof preferredCode === 'string' && preferredCode.trim().length > 0 ? preferredCode.trim() : null
  if (current && attributes.some((attribute) => attribute.code === current)) {
    return current
  }

  const candidates = [...extraCandidates, ...FIELD_CANDIDATES[key]]
  let bestAttribute: AkeneoAttribute | null = null
  let bestScore = 0
  for (const attribute of attributes) {
    const score = scoreAttributeForField(key, attribute, candidates)
    if (score > bestScore) {
      bestAttribute = attribute
      bestScore = score
    }
  }

  if (bestAttribute && bestScore > 0) {
    return bestAttribute.code
  }

  return current ?? FIELD_CANDIDATES[key][0].replace(/\s+/g, '_')
}

function dedupeCustomFieldMappings(mappings: AkeneoCustomFieldMapping[]): AkeneoCustomFieldMapping[] {
  const seen = new Set<string>()
  const deduped: AkeneoCustomFieldMapping[] = []
  for (const mapping of mappings) {
    const key = `${mapping.target}:${mapping.attributeCode}:${mapping.fieldKey}:${mapping.skip === true ? 'skip' : 'import'}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(mapping)
  }
  return deduped
}

function dedupeMediaMappings(mappings: AkeneoMediaMapping[]): AkeneoMediaMapping[] {
  const seen = new Set<string>()
  const deduped: AkeneoMediaMapping[] = []
  for (const mapping of mappings) {
    const key = `${mapping.target}:${mapping.kind}:${mapping.attributeCode}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(mapping)
  }
  return deduped
}

export function inferAkeneoProductMapping({
  attributes,
  family,
  familyVariant,
  fieldMap,
  explicitCustomFieldMappings,
  explicitMediaMappings,
}: InferAkeneoProductMappingInput): InferAkeneoProductMappingResult {
  const axisCodes = dedupeStrings(
    familyVariant?.variant_attribute_sets?.flatMap((set) => Array.isArray(set.axes) ? set.axes : []) ?? [],
  )
  const variantAttributeCodes = dedupeStrings(
    familyVariant?.variant_attribute_sets?.flatMap((set) => [
      ...(Array.isArray(set.axes) ? set.axes : []),
      ...(Array.isArray(set.attributes) ? set.attributes : []),
    ]) ?? [],
  )

  const resolvedFieldMap: Record<AkeneoProductFieldKey, string> = {
    title: pickFieldAttributeCode('title', attributes, family?.attribute_as_label ?? fieldMap.title, family?.attribute_as_label ? [family.attribute_as_label] : []),
    subtitle: pickFieldAttributeCode('subtitle', attributes, fieldMap.subtitle),
    description: pickFieldAttributeCode('description', attributes, fieldMap.description),
    sku: typeof fieldMap.sku === 'string' && fieldMap.sku.trim().length > 0 ? fieldMap.sku.trim() : 'sku',
    barcode: pickFieldAttributeCode('barcode', attributes, fieldMap.barcode),
    weight: pickFieldAttributeCode('weight', attributes, fieldMap.weight),
    variantName: pickFieldAttributeCode('variantName', attributes, fieldMap.variantName, family?.attribute_as_label ? [family.attribute_as_label] : []),
  }

  const explicitCustomAttributeCodes = new Set(explicitCustomFieldMappings.map((mapping) => mapping.attributeCode))
  const explicitMediaAttributeCodes = new Set(explicitMediaMappings.map((mapping) => mapping.attributeCode))
  const priceAttributeCodes = attributes
    .filter((attribute) => attribute.type === 'pim_catalog_price_collection')
    .map((attribute) => attribute.code)

  const excludedCustomFieldCodes = new Set<string>([
    ...Object.values(resolvedFieldMap),
    ...axisCodes,
    ...priceAttributeCodes,
    ...explicitMediaAttributeCodes,
    ...explicitCustomAttributeCodes,
  ])

  const autoCustomFieldMappings = dedupeCustomFieldMappings(
    attributes
      .map((attribute) => {
        if (excludedCustomFieldCodes.has(attribute.code)) return null
        if (isMediaAttributeType(attribute.type)) return null
        const kind = inferCustomFieldKind(attribute)
        if (!kind) return null
        return {
          attributeCode: attribute.code,
          fieldKey: attribute.code,
          target: variantAttributeCodes.includes(attribute.code) ? 'variant' : 'product',
          kind,
        } satisfies AkeneoCustomFieldMapping
      })
      .filter((mapping): mapping is {
        attributeCode: string
        fieldKey: string
        target: 'product' | 'variant'
        kind: AkeneoCustomFieldKind
      } => Boolean(mapping)),
  )

  const autoMediaMappings = dedupeMediaMappings(
    attributes
      .map((attribute) => {
        if (explicitMediaAttributeCodes.has(attribute.code) || !isMediaAttributeType(attribute.type)) return null
        return {
          attributeCode: attribute.code,
          target: variantAttributeCodes.includes(attribute.code) ? 'variant' : 'product',
          kind: isImageAttributeType(attribute.type) ? 'image' : 'file',
        } satisfies AkeneoMediaMapping
      })
      .filter((mapping): mapping is AkeneoMediaMapping => Boolean(mapping)),
  )

  return {
    axisCodes,
    variantAttributeCodes,
    optionSchemaAttributeCodes: axisCodes,
    fieldMap: resolvedFieldMap,
    autoCustomFieldMappings,
    autoMediaMappings,
    autoPriceAttributeCodes: priceAttributeCodes,
  }
}
