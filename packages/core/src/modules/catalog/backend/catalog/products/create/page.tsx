"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { ZodType } from "zod";
import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import {
  CrudForm,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from "@open-mercato/ui/backend/CrudForm";
import { createCrud } from "@open-mercato/ui/backend/utils/crud";
import { createCrudFormError } from "@open-mercato/ui/backend/utils/serverErrors";
import { flash } from "@open-mercato/ui/backend/FlashMessages";
import { TagsInput } from "@open-mercato/ui/backend/inputs/TagsInput";
import { Button } from "@open-mercato/ui/primitives/button";
import { Input } from "@open-mercato/ui/primitives/input";
import { Label } from "@open-mercato/ui/primitives/label";
import { cn } from "@open-mercato/shared/lib/utils";
import {
  Plus,
  Trash2,
  FileText,
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Settings,
} from "lucide-react";
import {
  apiCall,
  readApiResultOrThrow,
} from "@open-mercato/ui/backend/utils/apiCall";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { E } from "#generated/entities.ids.generated";
import {
  ProductMediaManager,
  type ProductMediaItem,
} from "@open-mercato/core/modules/catalog/components/products/ProductMediaManager";
import { ProductCategorizeSection } from "@open-mercato/core/modules/catalog/components/products/ProductCategorizeSection";
import {
  PRODUCT_FORM_STEPS,
  type PriceKindSummary,
  type PriceKindApiPayload,
  type TaxRateSummary,
  type ProductOptionInput,
  type VariantPriceValue,
  type VariantDraft,
  type ProductFormValues,
  type ProductUnitConversionDraft,
  type ProductUnitPriceReferenceUnit,
  type ProductUnitRoundingMode,
  productFormSchema,
  createInitialProductFormValues,
  createVariantDraft,
  buildOptionValuesKey,
  haveSameOptionValues,
  normalizePriceKindSummary,
  formatTaxRateLabel,
  slugify,
  createLocalId,
  buildOptionSchemaDefinition,
  buildVariantCombinations,
  normalizeProductDimensions,
  normalizeProductWeight,
  sanitizeProductDimensions,
  sanitizeProductWeight,
  updateDimensionValue,
  updateWeightValue,
} from "@open-mercato/core/modules/catalog/components/products/productForm";
import {
  buildAttachmentImageUrl,
  slugifyAttachmentFileName,
} from "@open-mercato/core/modules/attachments/lib/imageUrls";
import { ProductUomSection } from "@open-mercato/core/modules/catalog/components/products/ProductUomSection";
import { canonicalizeUnitCode } from "@open-mercato/core/modules/catalog/lib/unitCodes";

const productFormTypedSchema =
  productFormSchema as unknown as ZodType<ProductFormValues>;

type VariantPriceRequest = {
  variantDraftId: string;
  priceKindId: string;
  currencyCode: string;
  amount: number;
  displayMode: PriceKindSummary["displayMode"];
  taxRateId: string | null;
  taxRateValue: number | null;
};

type UiMarkdownEditorProps = {
  value?: string;
  height?: number;
  onChange?: (value?: string) => void;
  previewOptions?: { remarkPlugins?: unknown[] };
};

const MarkdownEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
      Loading editor…
    </div>
  ),
}) as unknown as React.ComponentType<UiMarkdownEditorProps>;

type ProductFormStep = (typeof PRODUCT_FORM_STEPS)[number];

const TRUE_BOOLEAN_VALUES = new Set(["true", "1", "yes", "y", "t"]);

type ProductUnitConversionInput = {
  unitCode: string;
  toBaseFactor: number;
  sortOrder: number;
  isActive: boolean;
};

const matchField = (fieldId: string) => (value: string) =>
  value === fieldId ||
  value.startsWith(`${fieldId}.`) ||
  value.startsWith(`${fieldId}[`);
const matchPrefix = (prefix: string) => (value: string) =>
  value.startsWith(prefix);

const STEP_FIELD_MATCHERS: Record<
  ProductFormStep,
  ((value: string) => boolean)[]
> = {
  general: [
    matchField("title"),
    matchField("description"),
    matchField("mediaItems"),
    matchField("mediaDraftId"),
    matchPrefix("defaultMedia"),
    matchPrefix("dimensions"),
    matchPrefix("weight"),
  ],
  organize: [
    matchField("categoryIds"),
    matchField("channelIds"),
    matchField("tags"),
  ],
  uom: [
    matchField("defaultUnit"),
    matchField("defaultSalesUnit"),
    matchField("defaultSalesUnitQuantity"),
    matchField("uomRoundingScale"),
    matchField("uomRoundingMode"),
    matchField("unitPriceEnabled"),
    matchField("unitPriceReferenceUnit"),
    matchField("unitPriceBaseQuantity"),
    matchPrefix("unitConversions"),
  ],
  variants: [
    matchField("hasVariants"),
    matchPrefix("options"),
    matchPrefix("variants"),
  ],
};

const UNIT_PRICE_REFERENCE_UNITS = new Set<ProductUnitPriceReferenceUnit>([
  "kg",
  "l",
  "m2",
  "m3",
  "pc",
]);

function toTrimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parseNumericInput(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, "").replace(",", ".");
    if (!normalized.length) return Number.NaN;
    return Number(normalized);
  }
  return Number(value);
}

function toPositiveNumberOrNull(value: unknown): number | null {
  const numeric = parseNumericInput(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function toIntegerInRangeOrDefault(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = parseNumericInput(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max)
    return fallback;
  return numeric;
}

function normalizeExistingTaxRateId(
  value: unknown,
  allowedIds: ReadonlySet<string>,
): string | null {
  const id = toTrimmedOrNull(value);
  if (!id) return null;
  return allowedIds.has(id) ? id : null;
}

function normalizeProductConversionInputs(
  rows: ProductUnitConversionDraft[] | undefined,
  duplicateMessage: string,
): ProductUnitConversionInput[] {
  const list = Array.isArray(rows) ? rows : [];
  const normalized: ProductUnitConversionInput[] = [];
  const seen = new Set<string>();
  for (const row of list) {
    const unitCode = canonicalizeUnitCode(row?.unitCode);
    const toBaseFactor = toPositiveNumberOrNull(row?.toBaseFactor);
    if (!unitCode || toBaseFactor === null) continue;
    const unitKey = unitCode.toLowerCase();
    if (seen.has(unitKey)) {
      throw createCrudFormError(duplicateMessage, {
        unitConversions: duplicateMessage,
      });
    }
    seen.add(unitKey);
    normalized.push({
      unitCode,
      toBaseFactor,
      sortOrder: toIntegerInRangeOrDefault(
        row?.sortOrder,
        0,
        100000,
        normalized.length * 10,
      ),
      isActive: row?.isActive !== false,
    });
  }
  return normalized;
}

function resolveStepForField(fieldId: string): ProductFormStep | null {
  const normalized = fieldId?.trim();
  if (!normalized) return null;
  for (const step of PRODUCT_FORM_STEPS) {
    const matchers = STEP_FIELD_MATCHERS[step];
    if (matchers.some((matcher) => matcher(normalized))) return step;
  }
  return null;
}

function resolveBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (TRUE_BOOLEAN_VALUES.has(normalized)) return true;
    if (["false", "0", "no", "n", "f"].includes(normalized)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return false;
}

export default function CreateCatalogProductPage() {
  const t = useT();
  const router = useRouter();
  const initialValuesRef = React.useRef<ProductFormValues | null>(null);
  if (!initialValuesRef.current) {
    initialValuesRef.current = createInitialProductFormValues();
  }
  const [priceKinds, setPriceKinds] = React.useState<PriceKindSummary[]>([]);
  const [taxRates, setTaxRates] = React.useState<TaxRateSummary[]>([]);
  React.useEffect(() => {
    const loadPriceKinds = async () => {
      try {
        const payload = await readApiResultOrThrow<{
          items?: PriceKindApiPayload[];
        }>("/api/catalog/price-kinds?pageSize=100", undefined, {
          errorMessage: t(
            "catalog.priceKinds.errors.load",
            "Failed to load price kinds.",
          ),
        });
        const items = Array.isArray(payload.items) ? payload.items : [];
        setPriceKinds(
          items
            .map((item) => normalizePriceKindSummary(item))
            .filter((item): item is PriceKindSummary => item !== null),
        );
      } catch (err) {
        console.error("catalog.price-kinds.fetch failed", err);
        setPriceKinds([]);
      }
    };
    loadPriceKinds().catch(() => {});
  }, [t]);

  React.useEffect(() => {
    const loadTaxRates = async () => {
      try {
        const payload = await readApiResultOrThrow<{
          items?: Array<Record<string, unknown>>;
        }>("/api/sales/tax-rates?pageSize=100", undefined, {
          errorMessage: t(
            "catalog.products.create.taxRates.error",
            "Failed to load tax rates.",
          ),
          fallback: { items: [] },
        });
        const items = Array.isArray(payload.items) ? payload.items : [];
        setTaxRates(
          items.map((item) => {
            const rawRate =
              typeof item.rate === "number"
                ? item.rate
                : Number(item.rate ?? Number.NaN);
            return {
              id: String(item.id),
              name:
                typeof item.name === "string" && item.name.trim().length
                  ? item.name
                  : t(
                      "catalog.products.create.taxRates.unnamed",
                      "Untitled tax rate",
                    ),
              code:
                typeof item.code === "string" && item.code.trim().length
                  ? item.code
                  : null,
              rate: Number.isFinite(rawRate) ? rawRate : null,
              isDefault: resolveBooleanFlag(
                typeof item.isDefault !== "undefined"
                  ? item.isDefault
                  : item.is_default,
              ),
            };
          }),
        );
      } catch (err) {
        console.error("sales.tax-rates.fetch failed", err);
        setTaxRates([]);
      }
    };
    loadTaxRates().catch(() => {});
  }, [t]);

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: "builder",
        column: 1,
        component: ({
          values,
          setValue,
          errors,
        }: CrudFormGroupComponentProps) => (
          <ProductBuilder
            values={values as ProductFormValues}
            setValue={setValue}
            errors={errors}
            priceKinds={priceKinds}
            taxRates={taxRates}
          />
        ),
      },
      {
        id: "product-meta",
        column: 2,
        title: t("catalog.products.create.meta.title", "Product meta"),
        description: t(
          "catalog.products.create.meta.description",
          "Manage subtitle and handle for storefronts.",
        ),
        component: ({
          values,
          setValue,
          errors,
        }: CrudFormGroupComponentProps) => (
          <ProductMetaSection
            values={values as ProductFormValues}
            setValue={setValue}
            errors={errors}
            taxRates={taxRates}
          />
        ),
      },
    ],
    [priceKinds, taxRates, t],
  );

  return (
    <Page>
      <PageBody>
        <CrudForm<ProductFormValues>
          title={t("catalog.products.create.title", "Create product")}
          backHref="/backend/catalog/products"
          fields={[]}
          groups={groups}
          injectionSpotId="crud-form:catalog.product"
          initialValues={
            initialValuesRef.current ?? createInitialProductFormValues()
          }
          schema={productFormTypedSchema}
          submitLabel={t("catalog.products.create.submit", "Create")}
          cancelHref="/backend/catalog/products"
          onSubmit={async (formValues) => {
            const title = formValues.title?.trim();
            if (!title) {
              throw createCrudFormError(
                t(
                  "catalog.products.create.errors.title",
                  "Provide a product title.",
                ),
                {
                  title: t(
                    "catalog.products.create.errors.title",
                    "Provide a product title.",
                  ),
                },
              );
            }
            const handle = formValues.handle?.trim() || undefined;
            const description = formValues.description?.trim() || undefined;
            const defaultMediaId =
              typeof formValues.defaultMediaId === "string" &&
              formValues.defaultMediaId.trim().length
                ? formValues.defaultMediaId
                : null;
            const mediaItems = Array.isArray(formValues.mediaItems)
              ? formValues.mediaItems
              : [];
            const attachmentIds = mediaItems
              .map((item) => (typeof item.id === "string" ? item.id : null))
              .filter((value): value is string => !!value);
            const mediaDraftId =
              typeof formValues.mediaDraftId === "string"
                ? formValues.mediaDraftId
                : "";
            const defaultMediaEntry = defaultMediaId
              ? mediaItems.find((item) => item.id === defaultMediaId)
              : null;
            const defaultMediaUrl = defaultMediaEntry
              ? buildAttachmentImageUrl(defaultMediaEntry.id, {
                  slug: slugifyAttachmentFileName(defaultMediaEntry.fileName),
                })
              : null;
            const optionSchemaDefinition = buildOptionSchemaDefinition(
              formValues.options,
              title,
            );
            const dimensions = sanitizeProductDimensions(
              formValues.dimensions ?? null,
            );
            const weight = sanitizeProductWeight(formValues.weight ?? null);
            const resolveTaxRateValue = (taxRateId?: string | null) => {
              if (!taxRateId) return null;
              const match = taxRates.find((rate) => rate.id === taxRateId);
              return typeof match?.rate === "number" ? match.rate : null;
            };
            const availableTaxRateIds = new Set(taxRates.map((rate) => rate.id));
            const productLevelTaxRateId = normalizeExistingTaxRateId(
              formValues.taxRateId,
              availableTaxRateIds,
            );
            const productTaxRate = resolveTaxRateValue(productLevelTaxRateId);
            const resolveVariantTax = (variant: VariantDraft) => {
              const variantTaxRateId = normalizeExistingTaxRateId(
                variant.taxRateId,
                availableTaxRateIds,
              );
              const resolvedVariantTaxRateId =
                variantTaxRateId ?? productLevelTaxRateId;
              const resolvedVariantTaxRate =
                resolveTaxRateValue(resolvedVariantTaxRateId) ??
                (resolvedVariantTaxRateId ? null : (productTaxRate ?? null));
              return { resolvedVariantTaxRateId, resolvedVariantTaxRate };
            };
            const defaultUnit = canonicalizeUnitCode(formValues.defaultUnit);
            const defaultSalesUnit = canonicalizeUnitCode(
              formValues.defaultSalesUnit,
            );
            const defaultSalesUnitQuantity =
              toPositiveNumberOrNull(formValues.defaultSalesUnitQuantity) ?? 1;
            const uomRoundingScale = toIntegerInRangeOrDefault(
              formValues.uomRoundingScale,
              0,
              6,
              4,
            );
            const uomRoundingMode: ProductUnitRoundingMode =
              formValues.uomRoundingMode === "down" ||
              formValues.uomRoundingMode === "up"
                ? formValues.uomRoundingMode
                : "half_up";
            const unitPriceEnabled = Boolean(formValues.unitPriceEnabled);
            const unitPriceReferenceUnit = canonicalizeUnitCode(
              formValues.unitPriceReferenceUnit,
            );
            const unitPriceBaseQuantity = toPositiveNumberOrNull(
              formValues.unitPriceBaseQuantity,
            );
            if (defaultSalesUnit && !defaultUnit) {
              const message = t(
                "catalog.products.uom.errors.baseRequired",
                "Base unit is required when default sales unit is set.",
              );
              throw createCrudFormError(message, { defaultSalesUnit: message });
            }
            const conversionInputs = normalizeProductConversionInputs(
              formValues.unitConversions,
              t(
                "catalog.products.uom.errors.duplicateConversion",
                "Duplicate conversion unit is not allowed.",
              ),
            );
            if (conversionInputs.length && !defaultUnit) {
              const message = t(
                "catalog.products.uom.errors.baseRequiredForConversions",
                "Base unit is required when conversions are configured.",
              );
              throw createCrudFormError(message, { defaultUnit: message });
            }
            const defaultUnitKey = defaultUnit?.toLowerCase() ?? null;
            const defaultSalesUnitKey = defaultSalesUnit?.toLowerCase() ?? null;
            if (
              defaultUnitKey &&
              defaultSalesUnitKey &&
              defaultSalesUnitKey !== defaultUnitKey
            ) {
              const hasDefaultSalesConversion = conversionInputs.some(
                (entry) =>
                  entry.isActive &&
                  entry.unitCode.toLowerCase() === defaultSalesUnitKey,
              );
              if (!hasDefaultSalesConversion) {
                const message = t(
                  "catalog.products.uom.errors.defaultSalesConversionRequired",
                  "Active conversion for default sales unit is required when it differs from base unit.",
                );
                throw createCrudFormError(message, {
                  defaultSalesUnit: message,
                  unitConversions: message,
                });
              }
            }
            if (unitPriceEnabled) {
              if (
                !unitPriceReferenceUnit ||
                !UNIT_PRICE_REFERENCE_UNITS.has(
                  unitPriceReferenceUnit as ProductUnitPriceReferenceUnit,
                )
              ) {
                const message = t(
                  "catalog.products.unitPrice.errors.referenceUnit",
                  "Reference unit is required when unit price display is enabled.",
                );
                throw createCrudFormError(message, {
                  unitPriceReferenceUnit: message,
                });
              }
              if (unitPriceBaseQuantity === null) {
                const message = t(
                  "catalog.products.unitPrice.errors.baseQuantity",
                  "Base quantity is required when unit price display is enabled.",
                );
                throw createCrudFormError(message, {
                  unitPriceBaseQuantity: message,
                });
              }
            }
            const productPayload: Record<string, unknown> = {
              title,
              subtitle: formValues.subtitle?.trim() || undefined,
              description,
              handle,
              taxRateId: productLevelTaxRateId,
              taxRate: productTaxRate ?? null,
              isConfigurable: Boolean(formValues.hasVariants),
              defaultMediaId: defaultMediaId ?? undefined,
              defaultMediaUrl: defaultMediaUrl ?? undefined,
              dimensions,
              weightValue: weight?.value ?? null,
              weightUnit: weight?.unit ?? null,
              defaultUnit: defaultUnit ?? null,
              defaultSalesUnit: defaultSalesUnit ?? defaultUnit ?? null,
              defaultSalesUnitQuantity,
              uomRoundingScale,
              uomRoundingMode,
              unitPriceEnabled,
              unitPriceReferenceUnit: unitPriceEnabled
                ? unitPriceReferenceUnit
                : undefined,
              unitPriceBaseQuantity: unitPriceEnabled
                ? unitPriceBaseQuantity
                : undefined,
            };
            if (optionSchemaDefinition) {
              productPayload.optionSchema = optionSchemaDefinition;
            }
            const categoryIds = Array.isArray(formValues.categoryIds)
              ? formValues.categoryIds
                  .map((id) => (typeof id === "string" ? id.trim() : ""))
                  .filter((id) => id.length)
              : [];
            if (categoryIds.length) {
              productPayload.categoryIds = Array.from(new Set(categoryIds));
            }
            const tags = Array.isArray(formValues.tags)
              ? Array.from(
                  new Set(
                    formValues.tags
                      .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
                      .filter((tag) => tag.length),
                  ),
                )
              : [];
            if (tags.length) {
              productPayload.tags = tags;
            }
            const channelIds = Array.isArray(formValues.channelIds)
              ? formValues.channelIds
                  .map((id) => (typeof id === "string" ? id.trim() : ""))
                  .filter((id) => id.length)
              : [];
            if (channelIds.length) {
              productPayload.offers = channelIds.map((channelId) => ({
                channelId,
                title,
                description,
                defaultMediaId: defaultMediaId ?? undefined,
                defaultMediaUrl: defaultMediaUrl ?? undefined,
              }));
            }

            const variantDrafts =
              (Array.isArray(formValues.variants) && formValues.variants.length
                ? formValues.variants
                : [
                    createVariantDraft(formValues.taxRateId ?? null, {
                      isDefault: true,
                    }),
                  ]) ?? [];
            const priceRequests: VariantPriceRequest[] = [];
            for (const variant of variantDrafts) {
              const { resolvedVariantTaxRateId, resolvedVariantTaxRate } =
                resolveVariantTax(variant);
              for (const priceKind of priceKinds) {
                const value = variant.prices?.[priceKind.id]?.amount?.trim();
                if (!value) continue;
                const numeric = Number(value);
                if (
                  Number.isNaN(numeric) ||
                  !Number.isFinite(numeric) ||
                  numeric < 0
                ) {
                  throw createCrudFormError(
                    t(
                      "catalog.products.create.errors.priceNonNegative",
                      "Prices must be zero or greater.",
                    ),
                  );
                }
                const currencyCode =
                  typeof priceKind.currencyCode === "string" &&
                  priceKind.currencyCode.trim().length
                    ? priceKind.currencyCode.trim().toUpperCase()
                    : "";
                if (!currencyCode) {
                  throw createCrudFormError(
                    t(
                      "catalog.products.create.errors.currency",
                      "Provide a currency for all price kinds.",
                    ),
                    {},
                  );
                }
                priceRequests.push({
                  variantDraftId: variant.id,
                  priceKindId: priceKind.id,
                  currencyCode,
                  amount: numeric,
                  displayMode: priceKind.displayMode,
                  taxRateId: resolvedVariantTaxRateId ?? null,
                  taxRateValue: resolvedVariantTaxRate ?? null,
                });
              }
            }

            const cleanupState: {
              productId: string | null;
              variantIds: string[];
            } = { productId: null, variantIds: [] };
            try {
              const { result: created } = await createCrud<{ id?: string }>(
                "catalog/products",
                productPayload,
              );
              const productId = created?.id;
              if (!productId) {
                throw createCrudFormError(
                  t(
                    "catalog.products.create.errors.id",
                    "Product id missing after create.",
                  ),
                );
              }
              cleanupState.productId = productId;

              for (const conversion of conversionInputs) {
                await createCrud("catalog/product-unit-conversions", {
                  productId,
                  unitCode: conversion.unitCode,
                  toBaseFactor: conversion.toBaseFactor,
                  sortOrder: conversion.sortOrder,
                  isActive: conversion.isActive,
                });
              }

              const variantIdMap: Record<string, string> = {};
              for (const variant of variantDrafts) {
                const { resolvedVariantTaxRateId, resolvedVariantTaxRate } =
                  resolveVariantTax(variant);
                const variantPayload: Record<string, unknown> = {
                  productId,
                  name:
                    variant.title?.trim() ||
                    Object.values(variant.optionValues).join(" / ") ||
                    "Variant",
                  sku: variant.sku?.trim() || undefined,
                  isDefault: Boolean(variant.isDefault),
                  isActive: true,
                  optionValues: Object.keys(variant.optionValues).length
                    ? variant.optionValues
                    : undefined,
                  taxRateId: resolvedVariantTaxRateId ?? null,
                  taxRate: resolvedVariantTaxRate ?? null,
                };
                const { result: variantResult } = await createCrud<{
                  id?: string;
                  variantId?: string;
                }>("catalog/variants", variantPayload);
                const variantId = variantResult?.variantId ?? variantResult?.id;
                if (!variantId) {
                  throw createCrudFormError(
                    t(
                      "catalog.products.create.errors.variant",
                      "Failed to create variant.",
                    ),
                  );
                }
                variantIdMap[variant.id] = variantId;
                cleanupState.variantIds.push(variantId);
              }

              for (const draft of priceRequests) {
                const variantId = variantIdMap[draft.variantDraftId];
                if (!variantId) continue;
                const pricePayload: Record<string, unknown> = {
                  productId,
                  variantId,
                  currencyCode: draft.currencyCode,
                  priceKindId: draft.priceKindId,
                };
                if (draft.taxRateId) {
                  pricePayload.taxRateId = draft.taxRateId;
                } else if (
                  typeof draft.taxRateValue === "number" &&
                  Number.isFinite(draft.taxRateValue)
                ) {
                  pricePayload.taxRate = draft.taxRateValue;
                }
                if (draft.displayMode === "including-tax") {
                  pricePayload.unitPriceGross = draft.amount;
                } else {
                  pricePayload.unitPriceNet = draft.amount;
                }
                await createCrud("catalog/prices", pricePayload);
              }

              if (mediaDraftId && attachmentIds.length) {
                const transfer = await apiCall<{
                  ok?: boolean;
                  error?: string;
                }>(
                  "/api/attachments/transfer",
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      entityId: E.catalog.catalog_product,
                      attachmentIds,
                      fromRecordId: mediaDraftId,
                      toRecordId: productId,
                    }),
                  },
                  { fallback: null },
                );
                if (!transfer.ok) {
                  console.error(
                    "attachments.transfer.failed",
                    transfer.result?.error,
                  );
                }
              }

              flash(
                t("catalog.products.create.success", "Product created."),
                "success",
              );
              router.push("/backend/catalog/products");
            } catch (err) {
              await cleanupFailedProduct(
                cleanupState.productId,
                cleanupState.variantIds,
              );
              throw err;
            }
          }}
        />
      </PageBody>
    </Page>
  );
}

async function cleanupFailedProduct(
  productId: string | null,
  variantIds: string[],
): Promise<void> {
  if (!productId && variantIds.length === 0) return;
  if (variantIds.length) {
    const variantDeletes = variantIds.map((variantId) =>
      apiCall(`/api/catalog/variants?id=${encodeURIComponent(variantId)}`, {
        method: "DELETE",
      }).catch(() => null),
    );
    await Promise.allSettled(variantDeletes);
  }
  if (productId) {
    await apiCall(`/api/catalog/products?id=${encodeURIComponent(productId)}`, {
      method: "DELETE",
    }).catch(() => null);
  }
}

type ProductBuilderProps = {
  values: ProductFormValues;
  setValue: (id: string, value: unknown) => void;
  errors: Record<string, string>;
  priceKinds: PriceKindSummary[];
  taxRates: TaxRateSummary[];
};

type ProductMetaSectionProps = {
  values: ProductFormValues;
  setValue: (id: string, value: unknown) => void;
  errors: Record<string, string>;
  taxRates: TaxRateSummary[];
};

type ProductDimensionsSectionProps = {
  values: ProductFormValues;
  setValue: (id: string, value: unknown) => void;
};

function ProductDimensionsFields({
  values,
  setValue,
}: ProductDimensionsSectionProps) {
  const t = useT();
  const dimensionValues = normalizeProductDimensions(values.dimensions);
  const weightValues = normalizeProductWeight(values.weight);

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">
        {t("catalog.products.edit.dimensions", "Dimensions & weight")}
      </h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            {t("catalog.products.edit.dimensions.width", "Width")}
          </Label>
          <Input
            type="number"
            value={dimensionValues?.width ?? ""}
            onChange={(event) =>
              setValue(
                "dimensions",
                updateDimensionValue(
                  values.dimensions ?? null,
                  "width",
                  event.target.value,
                ),
              )
            }
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            {t("catalog.products.edit.dimensions.height", "Height")}
          </Label>
          <Input
            type="number"
            value={dimensionValues?.height ?? ""}
            onChange={(event) =>
              setValue(
                "dimensions",
                updateDimensionValue(
                  values.dimensions ?? null,
                  "height",
                  event.target.value,
                ),
              )
            }
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            {t("catalog.products.edit.dimensions.depth", "Depth")}
          </Label>
          <Input
            type="number"
            value={dimensionValues?.depth ?? ""}
            onChange={(event) =>
              setValue(
                "dimensions",
                updateDimensionValue(
                  values.dimensions ?? null,
                  "depth",
                  event.target.value,
                ),
              )
            }
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            {t("catalog.products.edit.dimensions.unit", "Size unit")}
          </Label>
          <Input
            value={dimensionValues?.unit ?? ""}
            onChange={(event) =>
              setValue(
                "dimensions",
                updateDimensionValue(
                  values.dimensions ?? null,
                  "unit",
                  event.target.value,
                ),
              )
            }
            placeholder="cm"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            {t("catalog.products.edit.weight.value", "Weight")}
          </Label>
          <Input
            type="number"
            value={weightValues?.value ?? ""}
            onChange={(event) =>
              setValue(
                "weight",
                updateWeightValue(
                  values.weight ?? null,
                  "value",
                  event.target.value,
                ),
              )
            }
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            {t("catalog.products.edit.weight.unit", "Weight unit")}
          </Label>
          <Input
            value={weightValues?.unit ?? ""}
            onChange={(event) =>
              setValue(
                "weight",
                updateWeightValue(
                  values.weight ?? null,
                  "unit",
                  event.target.value,
                ),
              )
            }
            placeholder="kg"
          />
        </div>
      </div>
    </div>
  );
}

function ProductBuilder({
  values,
  setValue,
  errors,
  priceKinds,
  taxRates,
}: ProductBuilderProps) {
  const t = useT();
  const steps = PRODUCT_FORM_STEPS;
  const [currentStep, setCurrentStep] = React.useState(0);
  const defaultTaxRate = React.useMemo(
    () =>
      values.taxRateId
        ? (taxRates.find((rate) => rate.id === values.taxRateId) ?? null)
        : null,
    [taxRates, values.taxRateId],
  );
  React.useEffect(() => {
    if (values.taxRateId) return;
    if (!taxRates.length) return;
    const fallback = taxRates.find((rate) => rate.isDefault);
    if (!fallback) return;
    setValue("taxRateId", fallback.id);
  }, [taxRates, setValue, values.taxRateId]);
  const stepErrors = React.useMemo(() => {
    const map = steps.reduce<Record<ProductFormStep, string[]>>(
      (acc, step) => {
        acc[step] = [];
        return acc;
      },
      {} as Record<ProductFormStep, string[]>,
    );
    Object.entries(errors).forEach(([fieldId, message]) => {
      const step = resolveStepForField(fieldId);
      if (!step) return;
      const text =
        typeof message === "string" && message.trim().length
          ? message.trim()
          : null;
      if (text) map[step] = [...map[step], text];
    });
    return map;
  }, [errors, steps]);
  const errorSignature = React.useMemo(
    () => Object.keys(errors).sort().join("|"),
    [errors],
  );
  const lastErrorSignatureRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!errorSignature || errorSignature === lastErrorSignatureRef.current)
      return;
    lastErrorSignatureRef.current = errorSignature;
    const currentStepKey = steps[currentStep];
    if (currentStepKey && stepErrors[currentStepKey]?.length) return;
    const fallbackIndex = steps.findIndex(
      (step) => (stepErrors[step] ?? []).length > 0,
    );
    if (fallbackIndex >= 0 && fallbackIndex !== currentStep) {
      setCurrentStep(fallbackIndex);
    }
  }, [currentStep, errorSignature, setCurrentStep, stepErrors, steps]);
  const defaultTaxRateLabel = defaultTaxRate
    ? formatTaxRateLabel(defaultTaxRate)
    : null;
  const inventoryDisabledHint = t(
    "catalog.products.create.variantsBuilder.inventoryDisabled",
    "Inventory tracking controls are not available yet.",
  );

  React.useEffect(() => {
    if (currentStep >= steps.length) setCurrentStep(0);
  }, [currentStep, steps.length]);

  const currentStepKey = steps[currentStep] ?? steps[0];

  const mediaItems = React.useMemo(
    () => (Array.isArray(values.mediaItems) ? values.mediaItems : []),
    [values.mediaItems],
  );

  const handleMediaItemsChange = React.useCallback(
    (nextItems: ProductMediaItem[]) => {
      setValue("mediaItems", nextItems);
      const hasCurrent = nextItems.some(
        (item) => item.id === values.defaultMediaId,
      );
      if (!hasCurrent) {
        const fallbackId = nextItems[0]?.id ?? null;
        setValue("defaultMediaId", fallbackId);
        if (fallbackId && nextItems[0]) {
          setValue(
            "defaultMediaUrl",
            buildAttachmentImageUrl(fallbackId, {
              slug: slugifyAttachmentFileName(nextItems[0].fileName),
            }),
          );
        } else {
          setValue("defaultMediaUrl", "");
        }
      }
    },
    [setValue, values.defaultMediaId],
  );

  const handleDefaultMediaChange = React.useCallback(
    (attachmentId: string | null) => {
      setValue("defaultMediaId", attachmentId);
      if (!attachmentId) {
        setValue("defaultMediaUrl", "");
        return;
      }
      const target = mediaItems.find((item) => item.id === attachmentId);
      if (target) {
        setValue(
          "defaultMediaUrl",
          buildAttachmentImageUrl(target.id, {
            slug: slugifyAttachmentFileName(target.fileName),
          }),
        );
      }
    },
    [mediaItems, setValue],
  );

  const ensureVariants = React.useCallback(() => {
    const optionDefinitions = Array.isArray(values.options)
      ? values.options
      : [];
    if (!values.hasVariants || !optionDefinitions.length) {
      if (!values.variants || !values.variants.length) {
        setValue("variants", [
          createVariantDraft(values.taxRateId ?? null, { isDefault: true }),
        ]);
      }
      return;
    }
    const combos = buildVariantCombinations(optionDefinitions);
    const existing = Array.isArray(values.variants) ? values.variants : [];
    const existingByKey = new Map(
      existing.map((variant) => [
        buildOptionValuesKey(variant.optionValues),
        variant,
      ]),
    );
    let hasDefault = existing.some((variant) => variant.isDefault);
    let changed = existing.length !== combos.length;
    const nextVariants: VariantDraft[] = combos.map((combo, index) => {
      const key = buildOptionValuesKey(combo);
      const existingMatch = existingByKey.get(key);
      if (existingMatch) {
        if (existingMatch.isDefault) hasDefault = true;
        if (!haveSameOptionValues(existingMatch.optionValues, combo)) {
          changed = true;
          return { ...existingMatch, optionValues: combo };
        }
        if (existing[index] !== existingMatch) {
          changed = true;
        }
        return existingMatch;
      }
      changed = true;
      return createVariantDraft(values.taxRateId ?? null, {
        title: Object.values(combo).join(" / "),
        optionValues: combo,
      });
    });
    if (!nextVariants.length) return;
    if (!hasDefault) {
      changed = true;
      nextVariants[0] = { ...nextVariants[0], isDefault: true };
    }
    if (changed) {
      setValue("variants", nextVariants);
    }
  }, [
    values.options,
    values.variants,
    values.hasVariants,
    values.taxRateId,
    setValue,
  ]);

  React.useEffect(() => {
    ensureVariants();
  }, [ensureVariants]);

  React.useEffect(() => {
    if (!values.taxRateId) return;
    const variants = Array.isArray(values.variants) ? values.variants : [];
    if (!variants.length) return;
    let changed = false;
    const nextVariants = variants.map((variant) => {
      if (variant.taxRateId) return variant;
      changed = true;
      return { ...variant, taxRateId: values.taxRateId };
    });
    if (changed) {
      setValue("variants", nextVariants);
    }
  }, [values.taxRateId, values.variants, setValue]);
  const setVariantField = React.useCallback(
    (variantId: string, field: keyof VariantDraft, value: unknown) => {
      const next = (Array.isArray(values.variants) ? values.variants : []).map(
        (variant) => {
          if (variant.id !== variantId) return variant;
          return { ...variant, [field]: value };
        },
      );
      setValue("variants", next);
    },
    [values.variants, setValue],
  );

  const setVariantPrice = React.useCallback(
    (variantId: string, priceKindId: string, amount: string) => {
      if (amount.trim().startsWith("-")) return;
      const next = (Array.isArray(values.variants) ? values.variants : []).map(
        (variant) => {
          if (variant.id !== variantId) return variant;
          const nextPrices = { ...(variant.prices ?? {}) };
          if (amount === "") {
            delete nextPrices[priceKindId];
          } else {
            nextPrices[priceKindId] = { amount };
          }
          return {
            ...variant,
            prices: nextPrices,
          };
        },
      );
      setValue("variants", next);
    },
    [values.variants, setValue],
  );

  const markDefaultVariant = React.useCallback(
    (variantId: string) => {
      const next = (Array.isArray(values.variants) ? values.variants : []).map(
        (variant) => ({
          ...variant,
          isDefault: variant.id === variantId,
        }),
      );
      setValue("variants", next);
    },
    [values.variants, setValue],
  );

  const handleOptionTitleChange = React.useCallback(
    (optionId: string, title: string) => {
      const next = (Array.isArray(values.options) ? values.options : []).map(
        (option) => {
          if (option.id !== optionId) return option;
          return { ...option, title };
        },
      );
      setValue("options", next);
    },
    [values.options, setValue],
  );

  const setOptionValues = React.useCallback(
    (optionId: string, labels: string[]) => {
      const normalized = labels
        .map((label) => label.trim())
        .filter((label) => label.length);
      const unique = Array.from(new Set(normalized));
      const next = (Array.isArray(values.options) ? values.options : []).map(
        (option) => {
          if (option.id !== optionId) return option;
          const existingByLabel = new Map(
            option.values.map((value) => [value.label, value]),
          );
          const nextValues = unique.map(
            (label) =>
              existingByLabel.get(label) ?? { id: createLocalId(), label },
          );
          return {
            ...option,
            values: nextValues,
          };
        },
      );
      setValue("options", next);
    },
    [values.options, setValue],
  );

  const addOption = React.useCallback(() => {
    const next = [
      ...(Array.isArray(values.options) ? values.options : []),
      { id: createLocalId(), title: "", values: [] },
    ];
    setValue("options", next);
  }, [values.options, setValue]);

  const removeOption = React.useCallback(
    (optionId: string) => {
      const next = (Array.isArray(values.options) ? values.options : []).filter(
        (option) => option.id !== optionId,
      );
      setValue("options", next);
    },
    [values.options, setValue],
  );

  return (
    <div className="space-y-6">
      <nav className="flex gap-6 border-b pb-2 text-sm font-medium">
        {steps.map((step, index) => (
          <button
            key={step}
            type="button"
            className={cn(
              "relative pb-2",
              currentStep === index
                ? "text-foreground"
                : "text-muted-foreground",
            )}
            onClick={() => setCurrentStep(index)}
          >
            {step === "general" &&
              t("catalog.products.create.steps.general", "General data")}
            {step === "organize" &&
              t("catalog.products.create.steps.organize", "Organize")}
            {step === "uom" &&
              t("catalog.products.uom.title", "Units of measure")}
            {step === "variants" &&
              t("catalog.products.create.steps.variants", "Variants")}
            {(stepErrors[step]?.length ?? 0) > 0 ? (
              <span
                className="absolute -right-2 top-0 h-2 w-2 rounded-full bg-destructive"
                aria-hidden="true"
              />
            ) : null}
            {currentStep === index ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground rounded-full" />
            ) : null}
          </button>
        ))}
      </nav>

      {currentStepKey === "general" ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              {t("catalog.products.form.title", "Title")}
              <span className="text-red-600">*</span>
            </Label>
            <Input
              value={values.title}
              onChange={(event) => setValue("title", event.target.value)}
              placeholder={t(
                "catalog.products.create.placeholders.title",
                "e.g., Summer sneaker",
              )}
            />
            {errors.title ? (
              <p className="text-xs text-red-600">{errors.title}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                {t("catalog.products.form.description", "Description")}
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setValue("useMarkdown", !values.useMarkdown)}
                className="gap-2 text-xs"
              >
                {values.useMarkdown ? (
                  <AlignLeft className="h-4 w-4" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                {values.useMarkdown
                  ? t(
                      "catalog.products.create.actions.usePlain",
                      "Use plain text",
                    )
                  : t(
                      "catalog.products.create.actions.useMarkdown",
                      "Use markdown",
                    )}
              </Button>
            </div>
            {values.useMarkdown ? (
              <div
                data-color-mode="light"
                className="overflow-hidden rounded-md border"
              >
                <MarkdownEditor
                  value={values.description}
                  height={260}
                  onChange={(val) => setValue("description", val ?? "")}
                  previewOptions={{ remarkPlugins: [] }}
                />
              </div>
            ) : (
              <textarea
                className="min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={values.description}
                onChange={(event) =>
                  setValue("description", event.target.value)
                }
                placeholder={t(
                  "catalog.products.create.placeholders.description",
                  "Describe the product...",
                )}
              />
            )}
          </div>

          <ProductMediaManager
            entityId={E.catalog.catalog_product}
            draftRecordId={values.mediaDraftId}
            items={mediaItems}
            defaultMediaId={values.defaultMediaId ?? null}
            onItemsChange={handleMediaItemsChange}
            onDefaultChange={handleDefaultMediaChange}
          />

          <ProductDimensionsFields
            values={values as ProductFormValues}
            setValue={setValue}
          />
        </div>
      ) : null}

      {currentStepKey === "organize" ? (
        <ProductCategorizeSection
          values={values as ProductFormValues}
          setValue={setValue}
          errors={errors}
        />
      ) : null}

      {currentStepKey === "uom" ? (
        <ProductUomSection
          values={values as ProductFormValues}
          setValue={setValue}
          errors={errors}
          embedded
        />
      ) : null}

      {currentStepKey === "variants" ? (
        <div className="space-y-6">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border"
              checked={values.hasVariants}
              onChange={(event) =>
                setValue("hasVariants", event.target.checked)
              }
            />
            {t(
              "catalog.products.create.variantsBuilder.toggle",
              "Yes, this is a product with variants",
            )}
          </label>

          {values.hasVariants ? (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {t(
                    "catalog.products.create.optionsBuilder.title",
                    "Product options",
                  )}
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addOption}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t(
                    "catalog.products.create.optionsBuilder.add",
                    "Add option",
                  )}
                </Button>
              </div>
              {(Array.isArray(values.options) ? values.options : []).map(
                (option) => (
                  <div key={option.id} className="rounded-md bg-muted/40 p-4">
                    <div className="flex items-center gap-2">
                      <Input
                        value={option.title}
                        onChange={(event) =>
                          handleOptionTitleChange(option.id, event.target.value)
                        }
                        placeholder={t(
                          "catalog.products.create.optionsBuilder.placeholder",
                          "e.g., Color",
                        )}
                        className="flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        onClick={() => removeOption(option.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-3 space-y-2">
                      <Label className="text-xs uppercase text-muted-foreground">
                        {t(
                          "catalog.products.create.optionsBuilder.values",
                          "Values",
                        )}
                      </Label>
                      <TagsInput
                        value={option.values.map((value) => value.label)}
                        onChange={(labels) =>
                          setOptionValues(option.id, labels)
                        }
                        placeholder={t(
                          "catalog.products.create.optionsBuilder.valuePlaceholder",
                          "Type a value and press Enter",
                        )}
                      />
                    </div>
                  </div>
                ),
              )}
              {!values.options?.length ? (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "catalog.products.create.optionsBuilder.empty",
                    "No options yet. Add your first option to generate variants.",
                  )}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-lg border">
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left">
                      {t(
                        "catalog.products.create.variantsBuilder.defaultOption",
                        "Default option",
                      )}
                    </th>
                    <th className="px-3 py-2 text-left">
                      {t("catalog.products.form.variants", "Variant title")}
                    </th>
                    <th className="px-3 py-2 text-left">
                      {t("catalog.products.create.variantsBuilder.sku", "SKU")}
                    </th>
                    <th className="px-3 py-2 text-left">
                      {t(
                        "catalog.products.create.variantsBuilder.vatColumn",
                        "Tax class",
                      )}
                    </th>
                    {priceKinds.map((kind) => (
                      <th key={kind.id} className="px-3 py-2 text-left">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <span>
                              {t(
                                "catalog.products.create.variantsBuilder.priceColumn",
                                "Price {{title}}",
                              ).replace("{{title}}", kind.title)}
                            </span>
                            <small
                              title={
                                kind.displayMode === "including-tax"
                                  ? t(
                                      "catalog.priceKinds.form.displayMode.include",
                                      "Including tax",
                                    )
                                  : t(
                                      "catalog.priceKinds.form.displayMode.exclude",
                                      "Excluding tax",
                                    )
                              }
                              className="text-xs text-muted-foreground"
                            >
                              {kind.displayMode === "including-tax" ? "Ⓣ" : "Ⓝ"}
                            </small>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {kind.currencyCode?.toUpperCase() ??
                              t(
                                "catalog.products.create.variantsBuilder.currencyMissing",
                                "Currency missing",
                              )}
                          </span>
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-center">
                      {t(
                        "catalog.products.create.variantsBuilder.manageInventory",
                        "Managed inventory",
                      )}
                    </th>
                    <th className="px-3 py-2 text-center">
                      {t(
                        "catalog.products.create.variantsBuilder.allowBackorder",
                        "Allow backorder",
                      )}
                    </th>
                    <th className="px-3 py-2 text-center">
                      {t(
                        "catalog.products.create.variantsBuilder.inventoryKit",
                        "Has inventory kit",
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(values.variants) && values.variants.length
                    ? values.variants
                    : [
                        createVariantDraft(values.taxRateId ?? null, {
                          isDefault: true,
                        }),
                      ]
                  ).map((variant) => (
                    <tr key={variant.id} className="border-t">
                      <td className="px-3 py-2">
                        <label className="inline-flex items-center gap-1 text-xs">
                          <input
                            type="radio"
                            name="defaultVariant"
                            checked={variant.isDefault}
                            onChange={() => markDefaultVariant(variant.id)}
                          />
                          {variant.isDefault
                            ? t(
                                "catalog.products.create.variantsBuilder.defaultLabel",
                                "Default option value",
                              )
                            : t(
                                "catalog.products.create.variantsBuilder.makeDefault",
                                "Set as default",
                              )}
                        </label>
                        {values.hasVariants && variant.optionValues ? (
                          <p className="text-xs text-muted-foreground">
                            {Object.values(variant.optionValues).join(" / ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={variant.title}
                          onChange={(event) =>
                            setVariantField(
                              variant.id,
                              "title",
                              event.target.value,
                            )
                          }
                          placeholder={t(
                            "catalog.products.create.variantsBuilder.titlePlaceholder",
                            "Variant title",
                          )}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={variant.sku}
                          onChange={(event) =>
                            setVariantField(
                              variant.id,
                              "sku",
                              event.target.value,
                            )
                          }
                          placeholder={t(
                            "catalog.products.create.variantsBuilder.skuPlaceholder",
                            "e.g., SKU-001",
                          )}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          value={variant.taxRateId ?? ""}
                          onChange={(event) =>
                            setVariantField(
                              variant.id,
                              "taxRateId",
                              event.target.value || null,
                            )
                          }
                          disabled={!taxRates.length}
                        >
                          <option value="">
                            {defaultTaxRateLabel
                              ? t(
                                  "catalog.products.create.variantsBuilder.vatOptionDefault",
                                  "Use product tax class ({{label}})",
                                ).replace("{{label}}", defaultTaxRateLabel)
                              : t(
                                  "catalog.products.create.variantsBuilder.vatOptionNone",
                                  "No tax class",
                                )}
                          </option>
                          {taxRates.map((rate) => (
                            <option key={rate.id} value={rate.id}>
                              {formatTaxRateLabel(rate)}
                            </option>
                          ))}
                        </select>
                      </td>
                      {priceKinds.map((kind) => (
                        <td key={kind.id} className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {kind.currencyCode ?? "—"}
                            </span>
                            <input
                              type="number"
                              className="w-full rounded-md border px-2 py-1"
                              value={variant.prices?.[kind.id]?.amount ?? ""}
                              onChange={(event) =>
                                setVariantPrice(
                                  variant.id,
                                  kind.id,
                                  event.target.value,
                                )
                              }
                              placeholder="0.00"
                              min={0}
                            />
                          </div>
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border disabled:cursor-not-allowed disabled:opacity-60"
                          checked={variant.manageInventory}
                          onChange={(event) =>
                            setVariantField(
                              variant.id,
                              "manageInventory",
                              event.target.checked,
                            )
                          }
                          disabled
                          title={inventoryDisabledHint}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border disabled:cursor-not-allowed disabled:opacity-60"
                          checked={variant.allowBackorder}
                          onChange={(event) =>
                            setVariantField(
                              variant.id,
                              "allowBackorder",
                              event.target.checked,
                            )
                          }
                          disabled
                          title={inventoryDisabledHint}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border disabled:cursor-not-allowed disabled:opacity-60"
                          checked={variant.hasInventoryKit}
                          onChange={(event) =>
                            setVariantField(
                              variant.id,
                              "hasInventoryKit",
                              event.target.checked,
                            )
                          }
                          disabled
                          title={inventoryDisabledHint}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!priceKinds.length ? (
              <div className="flex items-center gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                {t(
                  "catalog.products.create.variantsBuilder.noPriceKinds",
                  "Configure price kinds in Catalog settings to add price columns.",
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex justify-between border-t pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("catalog.products.create.steps.previous", "Previous")}
        </Button>
        {currentStepKey !== "variants" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setCurrentStep(Math.min(steps.length - 1, currentStep + 1))
            }
            className="gap-2"
          >
            {t("catalog.products.create.steps.continue", "Continue")}
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

function ProductMetaSection({
  values,
  setValue,
  errors,
  taxRates,
}: ProductMetaSectionProps) {
  const t = useT();
  const handleValue = typeof values.handle === "string" ? values.handle : "";
  const titleSource = typeof values.title === "string" ? values.title : "";
  const autoHandleEnabledRef = React.useRef(handleValue.trim().length === 0);

  React.useEffect(() => {
    if (!autoHandleEnabledRef.current) return;
    const normalizedTitle = titleSource.trim();
    if (!normalizedTitle) {
      if (handleValue) {
        setValue("handle", "");
      }
      return;
    }
    const nextHandle = slugify(normalizedTitle);
    if (nextHandle !== handleValue) {
      setValue("handle", nextHandle);
    }
  }, [titleSource, handleValue, setValue]);

  const handleHandleInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      autoHandleEnabledRef.current = nextValue.trim().length === 0;
      setValue("handle", nextValue);
    },
    [setValue],
  );

  const handleGenerateHandle = React.useCallback(() => {
    const slug = slugify(titleSource);
    autoHandleEnabledRef.current = true;
    setValue("handle", slug);
  }, [titleSource, setValue]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t("catalog.products.form.subtitle", "Subtitle")}</Label>
        <Input
          value={typeof values.subtitle === "string" ? values.subtitle : ""}
          onChange={(event) => setValue("subtitle", event.target.value)}
          placeholder={t(
            "catalog.products.create.placeholders.subtitle",
            "Optional subtitle",
          )}
        />
        {errors.subtitle ? (
          <p className="text-xs text-red-600">{errors.subtitle}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label>{t("catalog.products.form.handle", "Handle")}</Label>
        <div className="flex gap-2">
          <Input
            value={handleValue}
            onChange={handleHandleInputChange}
            placeholder={t(
              "catalog.products.create.placeholders.handle",
              "e.g., summer-sneaker",
            )}
            className="font-mono lowercase"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleGenerateHandle}
          >
            {t("catalog.products.create.actions.generateHandle", "Generate")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            "catalog.products.create.handleHelp",
            "Handle is used for URLs and must be unique.",
          )}
        </p>
        {errors.handle ? (
          <p className="text-xs text-red-600">{errors.handle}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>
            {t("catalog.products.create.taxRates.label", "Tax class")}
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.open(
                  "/backend/config/sales?section=tax-rates",
                  "_blank",
                  "noopener,noreferrer",
                );
              }
            }}
            title={t(
              "catalog.products.create.taxRates.manage",
              "Manage tax classes",
            )}
            className="text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
            <span className="sr-only">
              {t(
                "catalog.products.create.taxRates.manage",
                "Manage tax classes",
              )}
            </span>
          </Button>
        </div>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={values.taxRateId ?? ""}
          onChange={(event) =>
            setValue("taxRateId", event.target.value || null)
          }
          disabled={!taxRates.length}
        >
          <option value="">
            {taxRates.length
              ? t(
                  "catalog.products.create.taxRates.noneSelected",
                  "No tax class selected",
                )
              : t(
                  "catalog.products.create.taxRates.emptyOption",
                  "No tax classes available",
                )}
          </option>
          {taxRates.map((rate) => (
            <option key={rate.id} value={rate.id}>
              {formatTaxRateLabel(rate)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {taxRates.length
            ? t(
                "catalog.products.create.taxRates.help",
                "Applied to new prices unless overridden per variant.",
              )
            : t(
                "catalog.products.create.taxRates.empty",
                "Define tax classes under Sales → Configuration.",
              )}
        </p>
        {errors.taxRateId ? (
          <p className="text-xs text-red-600">{errors.taxRateId}</p>
        ) : null}
      </div>
    </div>
  );
}
