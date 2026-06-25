import { z } from "zod";
import { slugify } from "@open-mercato/shared/lib/slugify";
import { parseObjectLike } from "@open-mercato/shared/lib/json/parseObjectLike";
import type { ReferenceUnitCode } from "@open-mercato/shared/lib/units/unitCodes";
import {
  CATALOG_CONFIGURABLE_PRODUCT_TYPES,
  type CatalogProductOptionSchema,
  type CatalogProductType,
} from "../../data/types";
import type { ProductMediaItem } from "./ProductMediaManager";

export { slugify };

export type PriceKindSummary = {
  id: string;
  code: string;
  title: string;
  currencyCode: string | null;
  displayMode: "including-tax" | "excluding-tax";
};

export type PriceKindApiPayload = {
  id?: string | number;
  code?: string;
  title?: string;
  currencyCode?: string | null;
  currency_code?: string | null;
  displayMode?: string | null;
  display_mode?: string | null;
};

export type TaxRateSummary = {
  id: string;
  name: string;
  code: string | null;
  rate: number | null;
  isDefault: boolean;
};

export function normalizeTaxRateSummary(
  item: Record<string, unknown>,
  fallbackName: string,
): TaxRateSummary | null {
  const id = typeof item.id === "string" ? item.id : null;
  if (!id) return null;
  const rawRate =
    typeof item.rate === "number" ? item.rate : Number(item.rate ?? Number.NaN);
  return {
    id,
    name:
      typeof item.name === "string" && item.name.trim().length
        ? item.name
        : fallbackName,
    code:
      typeof item.code === "string" && item.code.trim().length
        ? item.code
        : null,
    rate: Number.isFinite(rawRate) ? rawRate : null,
    isDefault: Boolean(
      typeof item.isDefault === "boolean"
        ? item.isDefault
        : typeof item.is_default === "boolean"
          ? item.is_default
          : false,
    ),
  };
}

export function mergeTaxRateSummaries(
  options: TaxRateSummary[],
  selected: TaxRateSummary | null,
): TaxRateSummary[] {
  if (!selected) return options;
  if (options.some((option) => option.id === selected.id)) return options;
  return [selected, ...options];
}

export type ProductOptionInput = {
  id: string;
  title: string;
  values: Array<{ id: string; label: string }>;
};

export type ProductDimensions = {
  width?: number;
  height?: number;
  depth?: number;
  unit?: string | null;
} | null;

export type ProductWeight = {
  value?: number;
  unit?: string | null;
} | null;

export type VariantPriceValue = {
  amount: string;
};

export type ProductUnitRoundingMode = "half_up" | "down" | "up";
export type ProductUnitPriceReferenceUnit = ReferenceUnitCode;

export type ProductUnitConversionDraft = {
  id: string | null;
  unitCode: string;
  toBaseFactor: string;
  sortOrder: string;
  isActive: boolean;
  /** The conversion row's version, for the per-row optimistic-lock header (#2055). Optional — only loaded rows carry it. */
  updatedAt?: string | null;
};

export type VariantDraft = {
  id: string;
  title: string;
  sku: string;
  isDefault: boolean;
  taxRateId: string | null;
  manageInventory: boolean;
  allowBackorder: boolean;
  hasInventoryKit: boolean;
  optionValues: Record<string, string>;
  prices: Record<string, VariantPriceValue>;
};

export type ProductFormValues = {
  title: string;
  subtitle: string;
  handle: string;
  sku: string;
  productType: CatalogProductType;
  description: string;
  useMarkdown: boolean;
  taxRateId: string | null;
  mediaDraftId: string;
  mediaItems: ProductMediaItem[];
  defaultMediaId: string | null;
  defaultMediaUrl: string;
  hasVariants: boolean;
  options: ProductOptionInput[];
  variants: VariantDraft[];
  metadata?: Record<string, unknown> | null;
  dimensions?: ProductDimensions;
  weight?: ProductWeight;
  defaultUnit: string | null;
  defaultSalesUnit: string | null;
  defaultSalesUnitQuantity: string;
  uomRoundingScale: string;
  uomRoundingMode: ProductUnitRoundingMode;
  unitPriceEnabled: boolean;
  unitPriceReferenceUnit: string | null;
  unitPriceBaseQuantity: string;
  unitConversions: ProductUnitConversionDraft[];
  customFieldsetCode?: string | null;
  categoryIds: string[];
  channelIds: string[];
  tags: string[];
  optionSchemaId?: string | null;
  updatedAt?: string | null;
  countryOfOriginCode: string;
  pkwiuCode: string;
  cnCode: string;
  hsCode: string;
  taxClassificationCode: string;
  gtuCodes: string[];
  ageMin: string;
  isExciseGood: boolean;
  exciseCategory: string | null;
  requiresPrescription: boolean;
  hazmatClass: string;
  unNumber: string;
  hazmatPackingGroup: string | null;
  containsLithiumBattery: boolean;
  launchAt: string;
  endOfLifeAt: string;
  availableFrom: string;
  availableUntil: string;
  minOrderQty: string;
  maxOrderQty: string;
  orderQtyIncrement: string;
  requiresShipping: boolean;
  isQuoteOnly: boolean;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
};

const optionalPositiveNumberInput = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && value.trim().length === 0) return undefined;
  return value;
}, z.coerce.number().positive().optional());

const optionalBoundedIntegerInput = (min: number, max: number) =>
  z.preprocess((value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "string" && value.trim().length === 0)
      return undefined;
    return value;
  }, z.coerce.number().int().min(min).max(max).optional());

export const productFormSchema = z
  .object({
    title: z.string().trim().min(1, "catalog.products.validation.titleRequired"),
    subtitle: z.string().optional(),
    handle: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9\-_]*$/,
        "catalog.products.validation.handleFormat",
      )
      .max(150)
      .optional(),
    sku: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9\-_\.]*$/,
        "catalog.products.validation.skuFormat",
      )
      .max(191)
      .optional(),
    productType: z.string().optional(),
    description: z.string().optional(),
    useMarkdown: z.boolean().optional(),
    taxRateId: z.string().uuid().nullable().optional(),
    hasVariants: z.boolean().optional(),
    mediaDraftId: z.string().optional(),
    mediaItems: z.any().optional(),
    defaultMediaId: z.string().uuid().nullable().optional(),
    defaultMediaUrl: z.string().trim().max(500).nullable().optional(),
    options: z.any().optional(),
    variants: z.any().optional(),
    // Use a permissive schema to avoid zod classic `_zod` runtime crashes on records in edge builds.
    metadata: z
      .custom<Record<string, unknown>>(() => true)
      .nullable()
      .optional(),
    dimensions: z
      .object({
        width: z.coerce.number().min(0).optional(),
        height: z.coerce.number().min(0).optional(),
        depth: z.coerce.number().min(0).optional(),
        unit: z.string().trim().max(25).optional(),
      })
      .nullable()
      .optional(),
    weight: z
      .object({
        value: z.coerce.number().min(0).optional(),
        unit: z.string().trim().max(25).optional(),
      })
      .nullable()
      .optional(),
    defaultUnit: z.string().trim().max(50).nullable().optional(),
    defaultSalesUnit: z.string().trim().max(50).nullable().optional(),
    defaultSalesUnitQuantity: optionalPositiveNumberInput,
    uomRoundingScale: optionalBoundedIntegerInput(0, 6),
    uomRoundingMode: z.enum(["half_up", "down", "up"]).optional(),
    unitPriceEnabled: z.boolean().optional(),
    unitPriceReferenceUnit: z.string().trim().max(50).nullable().optional(),
    unitPriceBaseQuantity: optionalPositiveNumberInput,
    unitConversions: z
      .array(
        z.object({
          id: z.string().nullable().optional(),
          unitCode: z.string().trim().max(50),
          toBaseFactor: z.coerce.number().positive(),
          sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
          isActive: z.boolean().optional(),
        }),
      )
      .optional(),
    customFieldsetCode: z.string().optional().nullable(),
    categoryIds: z.array(z.string().uuid()).optional(),
    channelIds: z.array(z.string().uuid()).optional(),
    tags: z.array(z.string().trim().min(1).max(100)).optional(),
    optionSchemaId: z.string().uuid().nullable().optional(),
    countryOfOriginCode: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{2})?$/, 'catalog.products.validation.countryCodeInvalid')
      .optional(),
    pkwiuCode: z.string().trim().max(32).optional(),
    cnCode: z.string().trim().max(32).optional(),
    hsCode: z.string().trim().max(32).optional(),
    taxClassificationCode: z.string().trim().max(64).optional(),
    gtuCodes: z.array(z.string()).optional(),
    ageMin: optionalBoundedIntegerInput(0, 120),
    isExciseGood: z.boolean().optional(),
    exciseCategory: z.string().nullable().optional(),
    requiresPrescription: z.boolean().optional(),
    hazmatClass: z.string().trim().max(32).optional(),
    unNumber: z
      .string()
      .trim()
      .regex(/^((?:UN)?[0-9]{4})?$/i, 'catalog.products.validation.unNumberInvalid')
      .optional(),
    hazmatPackingGroup: z.string().nullable().optional(),
    containsLithiumBattery: z.boolean().optional(),
    launchAt: z.string().optional(),
    endOfLifeAt: z.string().optional(),
    availableFrom: z.string().optional(),
    availableUntil: z.string().optional(),
    minOrderQty: optionalBoundedIntegerInput(1, 100000000),
    maxOrderQty: optionalBoundedIntegerInput(1, 100000000),
    orderQtyIncrement: optionalBoundedIntegerInput(1, 100000000),
    requiresShipping: z.boolean().optional(),
    isQuoteOnly: z.boolean().optional(),
    seoTitle: z.string().trim().max(255).optional(),
    seoDescription: z.string().trim().max(1000).optional(),
    canonicalUrl: z
      .string()
      .trim()
      .max(500)
      .regex(/^(https?:\/\/\S+)?$/, 'catalog.products.validation.canonicalUrlInvalid')
      .optional(),
  })
  .passthrough()
  .refine(
    (data) => !data.unitPriceEnabled || (data.unitPriceReferenceUnit != null && data.unitPriceReferenceUnit.length > 0),
    { message: 'catalog.products.validation.referenceUnitRequired', path: ['unitPriceReferenceUnit'] }
  )
  .refine(
    (data) => !data.defaultSalesUnit || (data.defaultUnit != null && data.defaultUnit.length > 0),
    { message: 'catalog.products.validation.baseUnitRequired', path: ['defaultUnit'] }
  )
  .refine(
    (data) =>
      data.minOrderQty === undefined ||
      data.maxOrderQty === undefined ||
      data.maxOrderQty >= data.minOrderQty,
    { message: 'catalog.products.validation.orderQtyRange', path: ['maxOrderQty'] }
  )
  .refine(
    (data) =>
      !data.launchAt ||
      !data.endOfLifeAt ||
      new Date(data.endOfLifeAt) >= new Date(data.launchAt),
    { message: 'catalog.products.validation.lifecycleDateRange', path: ['endOfLifeAt'] }
  )
  .refine(
    (data) =>
      !data.availableFrom ||
      !data.availableUntil ||
      new Date(data.availableUntil) >= new Date(data.availableFrom),
    { message: 'catalog.products.validation.availabilityDateRange', path: ['availableUntil'] }
  );

export const PRODUCT_FORM_STEPS = [
  "general",
  "organize",
  "uom",
  "compliance",
  "variants",
] as const;

export const BASE_INITIAL_VALUES: ProductFormValues = {
  title: "",
  subtitle: "",
  handle: "",
  sku: "",
  productType: "simple",
  description: "",
  useMarkdown: false,
  mediaDraftId: "",
  mediaItems: [],
  defaultMediaId: null,
  defaultMediaUrl: "",
  taxRateId: null,
  hasVariants: false,
  options: [],
  variants: [],
  metadata: {},
  dimensions: null,
  weight: null,
  defaultUnit: null,
  defaultSalesUnit: null,
  defaultSalesUnitQuantity: "1",
  uomRoundingScale: "4",
  uomRoundingMode: "half_up",
  unitPriceEnabled: false,
  unitPriceReferenceUnit: null,
  unitPriceBaseQuantity: "",
  unitConversions: [],
  customFieldsetCode: null,
  categoryIds: [],
  channelIds: [],
  tags: [],
  optionSchemaId: null,
  countryOfOriginCode: "",
  pkwiuCode: "",
  cnCode: "",
  hsCode: "",
  taxClassificationCode: "",
  gtuCodes: [],
  ageMin: "",
  isExciseGood: false,
  exciseCategory: null,
  requiresPrescription: false,
  hazmatClass: "",
  unNumber: "",
  hazmatPackingGroup: null,
  containsLithiumBattery: false,
  launchAt: "",
  endOfLifeAt: "",
  availableFrom: "",
  availableUntil: "",
  minOrderQty: "",
  maxOrderQty: "",
  orderQtyIncrement: "",
  requiresShipping: true,
  isQuoteOnly: false,
  seoTitle: "",
  seoDescription: "",
  canonicalUrl: "",
};

export const isConfigurableProductType = (type: string): boolean =>
  (CATALOG_CONFIGURABLE_PRODUCT_TYPES as readonly string[]).includes(type);

const complianceTrimOrNull = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length ? trimmed : null;
};

const compliancePositiveIntOrNull = (
  value: string | number | null | undefined,
): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) && Number.isInteger(value) ? value : null;
  }
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed.length) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && Number.isInteger(numeric) ? numeric : null;
};

const complianceDateOrNull = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed.length) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const buildComplianceProductPayload = (
  values: ProductFormValues,
): Record<string, unknown> => ({
  countryOfOriginCode: complianceTrimOrNull(values.countryOfOriginCode),
  pkwiuCode: complianceTrimOrNull(values.pkwiuCode),
  cnCode: complianceTrimOrNull(values.cnCode),
  hsCode: complianceTrimOrNull(values.hsCode),
  taxClassificationCode: complianceTrimOrNull(values.taxClassificationCode),
  gtuCodes:
    Array.isArray(values.gtuCodes) && values.gtuCodes.length
      ? values.gtuCodes
      : null,
  ageMin: compliancePositiveIntOrNull(values.ageMin),
  isExciseGood: values.isExciseGood === true,
  exciseCategory: complianceTrimOrNull(values.exciseCategory),
  requiresPrescription: values.requiresPrescription === true,
  hazmatClass: complianceTrimOrNull(values.hazmatClass),
  unNumber: complianceTrimOrNull(values.unNumber),
  hazmatPackingGroup: complianceTrimOrNull(values.hazmatPackingGroup),
  containsLithiumBattery: values.containsLithiumBattery === true,
  launchAt: complianceDateOrNull(values.launchAt),
  endOfLifeAt: complianceDateOrNull(values.endOfLifeAt),
  availableFrom: complianceDateOrNull(values.availableFrom),
  availableUntil: complianceDateOrNull(values.availableUntil),
  minOrderQty: compliancePositiveIntOrNull(values.minOrderQty),
  maxOrderQty: compliancePositiveIntOrNull(values.maxOrderQty),
  orderQtyIncrement: compliancePositiveIntOrNull(values.orderQtyIncrement),
  requiresShipping: values.requiresShipping !== false,
  isQuoteOnly: values.isQuoteOnly === true,
  seoTitle: complianceTrimOrNull(values.seoTitle),
  seoDescription: complianceTrimOrNull(values.seoDescription),
  canonicalUrl: complianceTrimOrNull(values.canonicalUrl),
});

export type ComplianceFormValues = Pick<
  ProductFormValues,
  | "countryOfOriginCode"
  | "pkwiuCode"
  | "cnCode"
  | "hsCode"
  | "taxClassificationCode"
  | "gtuCodes"
  | "ageMin"
  | "isExciseGood"
  | "exciseCategory"
  | "requiresPrescription"
  | "hazmatClass"
  | "unNumber"
  | "hazmatPackingGroup"
  | "containsLithiumBattery"
  | "launchAt"
  | "endOfLifeAt"
  | "availableFrom"
  | "availableUntil"
  | "minOrderQty"
  | "maxOrderQty"
  | "orderQtyIncrement"
  | "requiresShipping"
  | "isQuoteOnly"
  | "seoTitle"
  | "seoDescription"
  | "canonicalUrl"
>;

export const complianceFormValuesFromApiRecord = (
  record: Record<string, unknown>,
): ComplianceFormValues => {
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    return null;
  };
  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const strOrNull = (value: unknown): string | null =>
    typeof value === "string" && value.length ? value : null;
  const numStr = (value: unknown): string =>
    typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const boolWithDefault = (value: unknown, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;
  const dateInput = (value: unknown): string =>
    typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "";
  const stringArray = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  return {
    countryOfOriginCode: str(pick("country_of_origin_code", "countryOfOriginCode")),
    pkwiuCode: str(pick("pkwiu_code", "pkwiuCode")),
    cnCode: str(pick("cn_code", "cnCode")),
    hsCode: str(pick("hs_code", "hsCode")),
    taxClassificationCode: str(pick("tax_classification_code", "taxClassificationCode")),
    gtuCodes: stringArray(pick("gtu_codes", "gtuCodes")),
    ageMin: numStr(pick("age_min", "ageMin")),
    isExciseGood: boolWithDefault(pick("is_excise_good", "isExciseGood"), false),
    exciseCategory: strOrNull(pick("excise_category", "exciseCategory")),
    requiresPrescription: boolWithDefault(
      pick("requires_prescription", "requiresPrescription"),
      false,
    ),
    hazmatClass: str(pick("hazmat_class", "hazmatClass")),
    unNumber: str(pick("un_number", "unNumber")),
    hazmatPackingGroup: strOrNull(pick("hazmat_packing_group", "hazmatPackingGroup")),
    containsLithiumBattery: boolWithDefault(
      pick("contains_lithium_battery", "containsLithiumBattery"),
      false,
    ),
    launchAt: dateInput(pick("launch_at", "launchAt")),
    endOfLifeAt: dateInput(pick("end_of_life_at", "endOfLifeAt")),
    availableFrom: dateInput(pick("available_from", "availableFrom")),
    availableUntil: dateInput(pick("available_until", "availableUntil")),
    minOrderQty: numStr(pick("min_order_qty", "minOrderQty")),
    maxOrderQty: numStr(pick("max_order_qty", "maxOrderQty")),
    orderQtyIncrement: numStr(pick("order_qty_increment", "orderQtyIncrement")),
    requiresShipping: boolWithDefault(
      pick("requires_shipping", "requiresShipping"),
      true,
    ),
    isQuoteOnly: boolWithDefault(pick("is_quote_only", "isQuoteOnly"), false),
    seoTitle: str(pick("seo_title", "seoTitle")),
    seoDescription: str(pick("seo_description", "seoDescription")),
    canonicalUrl: str(pick("canonical_url", "canonicalUrl")),
  };
};

export const createInitialProductFormValues = (): ProductFormValues => ({
  ...BASE_INITIAL_VALUES,
  mediaDraftId: createLocalId(),
  variants: [createVariantDraft(null, { isDefault: true })],
});

export const createVariantDraft = (
  productTaxRateId: string | null,
  overrides: Partial<VariantDraft> = {},
): VariantDraft => ({
  id: createLocalId(),
  title: "Default variant",
  sku: "",
  isDefault: false,
  taxRateId: productTaxRateId ?? null,
  manageInventory: false,
  allowBackorder: false,
  hasInventoryKit: false,
  optionValues: {},
  prices: {},
  ...overrides,
});

export const createProductUnitConversionDraft = (
  overrides: Partial<ProductUnitConversionDraft> = {},
): ProductUnitConversionDraft => ({
  id: null,
  unitCode: "",
  toBaseFactor: "",
  sortOrder: "",
  isActive: true,
  ...overrides,
});

export const buildOptionValuesKey = (
  optionValues?: Record<string, string>,
): string => {
  if (!optionValues) return "";
  return Object.keys(optionValues)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}:${optionValues[key] ?? ""}`)
    .join("|");
};

export const haveSameOptionValues = (
  current: Record<string, string> | undefined,
  next: Record<string, string>,
): boolean => {
  const a = current ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(next)]);
  for (const key of keys) {
    if ((a[key] ?? "") !== (next[key] ?? "")) return false;
  }
  return true;
};

const parseNumeric = (input: unknown): number | null => {
  const numeric = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
};

export const normalizeProductDimensions = (raw: unknown): ProductDimensions => {
  const source = parseObjectLike(raw);
  if (!source) return null;
  const width = parseNumeric(source.width);
  const height = parseNumeric(source.height);
  const depth = parseNumeric(source.depth);
  const unit =
    typeof source.unit === "string" && source.unit.trim().length
      ? source.unit.trim()
      : null;
  const clean: Record<string, unknown> = {};
  if (width !== null) clean.width = width;
  if (height !== null) clean.height = height;
  if (depth !== null) clean.depth = depth;
  if (unit) clean.unit = unit;
  return Object.keys(clean).length ? (clean as ProductDimensions) : null;
};

export const normalizeProductWeight = (raw: unknown): ProductWeight => {
  const source = parseObjectLike(raw);
  if (!source) return null;
  const value = parseNumeric(source.value);
  const unit =
    typeof source.unit === "string" && source.unit.trim().length
      ? source.unit.trim()
      : null;
  if (value === null && !unit) return null;
  const clean: Record<string, unknown> = {};
  if (value !== null) clean.value = value;
  if (unit) clean.unit = unit;
  return clean as ProductWeight;
};

export const sanitizeProductDimensions = (
  raw: ProductDimensions,
): ProductDimensions => {
  return normalizeProductDimensions(raw ?? null);
};

export const sanitizeProductWeight = (raw: ProductWeight): ProductWeight => {
  return normalizeProductWeight(raw ?? null);
};

export const updateDimensionValue = (
  current: ProductDimensions,
  field: "width" | "height" | "depth" | "unit",
  raw: string,
): ProductDimensions => {
  const base = normalizeProductDimensions(current) ?? {};
  if (field === "unit") {
    base.unit = raw;
  } else {
    const numeric = parseNumeric(raw);
    if (numeric === null) {
      delete base[field];
    } else {
      base[field] = numeric;
    }
  }
  return sanitizeProductDimensions(base);
};

export const updateWeightValue = (
  current: ProductWeight,
  field: "value" | "unit",
  raw: string,
): ProductWeight => {
  const base = normalizeProductWeight(current) ?? {};
  if (field === "unit") {
    base.unit = raw;
  } else {
    const numeric = parseNumeric(raw);
    if (numeric === null) {
      delete (base as Record<string, unknown>).value;
    } else {
      base.value = numeric;
    }
  }
  return sanitizeProductWeight(base);
};

export const normalizePriceKindSummary = (
  input: PriceKindApiPayload | undefined | null,
): PriceKindSummary | null => {
  if (!input) return null;
  const getString = (value: unknown): string | null => {
    if (typeof value === "string" && value.trim().length) return value.trim();
    if (typeof value === "number" || typeof value === "bigint")
      return String(value);
    return null;
  };
  const id = getString(input.id);
  const code = getString(input.code);
  const title = getString(input.title);
  if (!id || !code || !title) return null;
  const currency =
    getString(input.currencyCode) ?? getString(input.currency_code);
  const displayRaw =
    getString(input.displayMode) ?? getString(input.display_mode);
  const displayMode: PriceKindSummary["displayMode"] =
    displayRaw === "including-tax" ? "including-tax" : "excluding-tax";
  return {
    id,
    code,
    title,
    currencyCode: currency,
    displayMode,
  };
};

export const formatTaxRateLabel = (rate: TaxRateSummary): string => {
  const extras: string[] = [];
  if (typeof rate.rate === "number" && Number.isFinite(rate.rate)) {
    extras.push(`${rate.rate}%`);
  }
  if (rate.code) {
    extras.push(rate.code.toUpperCase());
  }
  if (!extras.length) return rate.name;
  return `${rate.name} • ${extras.join(" · ")}`;
};

export function createLocalId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function buildOptionSchemaDefinition(
  options: ProductOptionInput[] | undefined,
  name: string,
): CatalogProductOptionSchema | null {
  const list = Array.isArray(options) ? options : [];
  if (!list.length) return null;
  const normalizedName =
    name && name.trim().length ? name.trim() : "Product options";
  const schemaOptions = list
    .map((option) => {
      const title = option.title?.trim() || "";
      const code = resolveOptionCode(option);
      const values = Array.isArray(option.values) ? option.values : [];
      return {
        code: code || slugify(createLocalId()),
        label: title || code || "Option",
        inputType: "select" as const,
        choices: values
          .map((value) => {
            const label = value.label?.trim() || "";
            const valueCode = slugify(label || value.id || createLocalId());
            if (!label && !valueCode) return null;
            return {
              code: valueCode || slugify(createLocalId()),
              label: label || valueCode || "Choice",
            };
          })
          .filter((entry): entry is { code: string; label: string } => !!entry),
      };
    })
    .filter((entry) => entry.label.trim().length);
  if (!schemaOptions.length) return null;
  return {
    version: 1,
    name: normalizedName,
    options: schemaOptions,
  };
}

export function convertSchemaToProductOptions(
  schema: CatalogProductOptionSchema | null | undefined,
): ProductOptionInput[] {
  if (!schema || !Array.isArray(schema.options)) return [];
  return schema.options.map((option) => ({
    id: createLocalId(),
    title: option.label ?? option.code ?? "Option",
    values: Array.isArray(option.choices)
      ? option.choices.map((choice) => ({
          id: createLocalId(),
          label: choice.label ?? choice.code ?? "",
        }))
      : [],
  }));
}

function resolveOptionCode(option: ProductOptionInput): string {
  const base = option.title?.trim() || option.id?.trim() || "";
  const slugged = slugify(base);
  if (slugged.length) return slugged;
  if (base.length) return base;
  return createLocalId();
}

export function buildVariantCombinations(
  options: ProductOptionInput[],
): Record<string, string>[] {
  if (!options.length) return [];
  const [first, ...rest] = options;
  if (!first || !Array.isArray(first.values) || !first.values.length) return [];
  const firstKey = resolveOptionCode(first);
  const initial = first.values.map((value) => ({ [firstKey]: value.label }));
  return rest.reduce<Record<string, string>[]>((acc, option) => {
    if (!Array.isArray(option.values) || !option.values.length) return [];
    const optionKey = resolveOptionCode(option);
    const combos: Record<string, string>[] = [];
    acc.forEach((partial) => {
      option.values.forEach((value) => {
        combos.push({ ...partial, [optionKey]: value.label });
      });
    });
    return combos;
  }, initial);
}

export type VariantMediaFallbackInput = {
  isDefault: boolean;
  defaultMediaId: string | null;
  name: string;
};

export type VariantMediaFallbackResult = {
  defaultMediaId: string;
  variantName: string;
} | null;

export function resolveVariantMediaFallback(
  variants: VariantMediaFallbackInput[],
): VariantMediaFallbackResult {
  const defaultVariant = variants.find(
    (v) => v.isDefault && v.defaultMediaId,
  );
  const fallback = defaultVariant ?? variants.find((v) => v.defaultMediaId);
  if (fallback?.defaultMediaId) {
    return { defaultMediaId: fallback.defaultMediaId, variantName: fallback.name };
  }
  return null;
}
