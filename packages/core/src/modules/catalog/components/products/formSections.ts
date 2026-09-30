"use client";

/**
 * The catalog product edit form, described as ten sections.
 *
 * Before this table, a section's card lived in the page's `groups` array while
 * the validation it owned, the slice of the update payload it contributed and
 * the secondary writes it triggered were unrelated inline branches of one long
 * `handleSubmit`. Nothing tied them together, so "hide this card" could not
 * mean "and stop validating, sending and rewriting its data" — and on this form
 * that gap is not cosmetic: `buildComplianceProductPayload` emits all 23
 * compliance/SEO keys on every save, nulling the blanks, so a merely-hidden
 * compliance card would wipe stored PKWiU/CN/GTU/SEO values the next time a
 * user saved anything else.
 *
 * Each descriptor therefore owns all four facets for one section, and the page
 * derives its `groups`, its `hiddenGroupIds`, its validation, its payload and
 * its post-save writes from this one list. Hiding a section can no longer
 * desynchronise from hiding its behaviour, because there is only one place that
 * says what a section is.
 *
 * Omission is safe on the server side, and that was verified rather than
 * assumed: `productUpdateSchema` is `.partial()` and `catalog.product.update`
 * gates every scalar and relation behind `!== undefined`, so leaving a key out
 * preserves the stored value while an explicit `null` would clear it.
 */

import { createCrudFormError } from "@open-mercato/ui/backend/utils/serverErrors";
import type {
  ProductFormValues,
  ProductUnitPriceReferenceUnit,
  ProductUnitRoundingMode,
} from "@open-mercato/core/modules/catalog/components/products/productForm";
import { buildComplianceProductPayload } from "@open-mercato/core/modules/catalog/components/products/productForm";
import {
  UNIT_PRICE_REFERENCE_UNITS,
  type ProductUnitConversionInput,
} from "@open-mercato/core/modules/catalog/components/products/productFormUtils";
import type { CatalogProductOptionSchema } from "@open-mercato/core/modules/catalog/data/types";

/**
 * The stable, shipped section ids of `/backend/catalog/products/[id]`.
 *
 * `BACKWARD_COMPATIBILITY.md` §3 classifies built-in `CrudFormGroup.id` values
 * as a protected surface: an app names these in
 * `overrides.forms.sections['crud-form:catalog.product']`, and an unmatched id
 * is ignored, so renaming one would silently un-hide a card an app had hidden.
 * Adding ids is free; renaming or removing one follows the deprecation
 * protocol. Pinned by `catalogProductFormSections.test.ts`.
 */
export const CATALOG_PRODUCT_FORM_SECTION_IDS = [
  "details",
  "dimensions",
  "metadata",
  "options",
  "product-uom",
  "compliance",
  "variants",
  "meta",
  "categorize",
  "custom-fields",
] as const;

export type CatalogProductFormSectionId =
  (typeof CATALOG_PRODUCT_FORM_SECTION_IDS)[number];

/** The CrudForm host this form's section policy is keyed on. */
export const CATALOG_PRODUCT_FORM_HOST_ID = "crud-form:catalog.product";

type SectionTranslate = (key: string, fallback?: string) => string;

type OfferPayloadLike = {
  id?: string;
  channelId: string;
  title: string;
  description?: string;
  defaultMediaId?: string | null;
  defaultMediaUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  isActive?: boolean;
};

type OfferSnapshotLike = {
  id: string | null;
  channelId: string;
  updatedAt: string | null;
};

type ConversionDraftLike = {
  id: string | null;
  unitCode: string;
  toBaseFactor: string;
  sortOrder: string;
  isActive: boolean;
};

/**
 * Values the page derives once from the parsed form, shared by the descriptors
 * so validation, payload and writes cannot disagree about what a save means.
 * Deriving stays in the page: this refactor moves the *partition*, not the
 * arithmetic, which is what keeps the no-override path byte-identical.
 */
export type CatalogProductSectionDerived = {
  title: string;
  handle: string | undefined;
  description: string | undefined;
  metadata: Record<string, unknown>;
  dimensions: ProductFormValues["dimensions"];
  weightValue: number | null;
  weightUnit: string | null;
  productType: string;
  isConfigurable: boolean;
  taxRateId: string | null;
  productTaxRateValue: number | null;
  defaultMediaId: string | null;
  defaultMediaUrl: string | null;
  defaultUnit: string | null;
  defaultSalesUnit: string | null;
  defaultSalesUnitQuantity: number;
  uomRoundingScale: number;
  uomRoundingMode: ProductUnitRoundingMode;
  unitPriceEnabled: boolean;
  unitPriceReferenceUnit: string | null;
  unitPriceBaseQuantity: number | null;
  conversionInputs: ProductUnitConversionInput[];
  categoryIds: string[];
  channelIds: string[];
  tags: string[];
  optionSchemaDefinition: CatalogProductOptionSchema | null;
  previousOptionSchemaId: string | null;
  customFields: Record<string, unknown>;
  offersPayload: OfferPayloadLike[];
};

export type CatalogProductSectionContext = {
  productId: string;
  /** Parsed form values, with hidden sections already restored to loaded values. */
  values: ProductFormValues;
  derived: CatalogProductSectionDerived;
  t: SectionTranslate;
};

export type CatalogProductSectionWriteContext = CatalogProductSectionContext & {
  conversions: {
    /** Conversions as loaded, for their ids and optimistic-lock versions. */
    loaded: ConversionDraftLike[];
    versions: Map<string, string | null>;
    onPersisted: (next: ConversionDraftLike[]) => void;
  };
  offers: {
    snapshots: OfferSnapshotLike[];
    onPersisted: (payloads: OfferPayloadLike[]) => void;
  };
  io: CatalogProductSectionIo;
};

/**
 * The write helpers, injected rather than imported, so a unit test can observe
 * exactly which secondary writes a section performs without standing up the
 * whole HTTP layer.
 */
export type CatalogProductSectionIo = {
  createCrud: (resource: string, payload: unknown) => Promise<{ result?: unknown }>;
  updateCrud: (resource: string, payload: unknown) => Promise<unknown>;
  deleteCrud: (
    resource: string,
    id: string,
    options?: { errorMessage?: string },
  ) => Promise<unknown>;
  withScopedApiRequestHeaders: <T>(
    headers: Record<string, string>,
    run: () => Promise<T>,
  ) => Promise<T>;
  buildOptimisticLockHeader: (updatedAt: string | null) => Record<string, string>;
  onOfferDeleteFailed: (err: unknown) => never;
};

export type CatalogProductFormSection = {
  id: CatalogProductFormSectionId;
  /**
   * The `ProductFormValues` keys this section owns.
   *
   * Two things read it: the pre-validation restore (a hidden section's fields
   * revert to their loaded values, so they can neither fail validation the user
   * cannot see nor carry an edit into a payload they are excluded from), and
   * the guard test that fails the build when a newly added form field is
   * attributed to no section.
   */
  ownedFields: readonly (keyof ProductFormValues)[];
  /** Client validation owned by this section. Throws `createCrudFormError`. */
  validate?: (ctx: CatalogProductSectionContext) => void;
  /** This section's slice of the `catalog/products` update payload. */
  buildPayload?: (ctx: CatalogProductSectionContext) => Record<string, unknown>;
  /** Secondary writes this section owns, before the product update. */
  writeBefore?: (ctx: CatalogProductSectionWriteContext) => Promise<void>;
  /** Secondary writes this section owns, after the product update. */
  writeAfter?: (ctx: CatalogProductSectionWriteContext) => Promise<void>;
};

export const CATALOG_PRODUCT_FORM_SECTIONS: readonly CatalogProductFormSection[] = [
  {
    id: "details",
    ownedFields: [
      "title",
      "description",
      "useMarkdown",
      "mediaItems",
      "mediaDraftId",
      "defaultMediaId",
      "defaultMediaUrl",
    ],
    validate: ({ derived, t }) => {
      if (!derived.title) {
        const message = t(
          "catalog.products.create.errors.title",
          "Provide a product title.",
        );
        throw createCrudFormError(message, { title: message });
      }
    },
    buildPayload: ({ derived }) => ({
      title: derived.title,
      description: derived.description,
      defaultMediaId: derived.defaultMediaId ?? undefined,
      defaultMediaUrl: derived.defaultMediaUrl ?? undefined,
    }),
  },
  {
    id: "dimensions",
    ownedFields: ["dimensions", "weight"],
    buildPayload: ({ derived }) => ({
      dimensions: derived.dimensions,
      weightValue: derived.weightValue,
      weightUnit: derived.weightUnit,
    }),
  },
  {
    id: "metadata",
    ownedFields: ["metadata"],
    buildPayload: ({ derived }) => ({ metadata: derived.metadata }),
  },
  {
    id: "options",
    ownedFields: ["options", "optionSchemaId"],
    buildPayload: ({ derived }) => {
      if (derived.optionSchemaDefinition) {
        return { optionSchema: derived.optionSchemaDefinition };
      }
      // Only clear a previously bound schema; never send `optionSchemaId: null`
      // for a product that never had one.
      if (derived.previousOptionSchemaId) return { optionSchemaId: null };
      return {};
    },
  },
  {
    id: "product-uom",
    ownedFields: [
      "defaultUnit",
      "defaultSalesUnit",
      "defaultSalesUnitQuantity",
      "uomRoundingScale",
      "uomRoundingMode",
      "unitPriceEnabled",
      "unitPriceReferenceUnit",
      "unitPriceBaseQuantity",
      "unitConversions",
    ],
    validate: ({ derived, t }) => {
      if (derived.defaultSalesUnit && !derived.defaultUnit) {
        const message = t(
          "catalog.products.uom.errors.baseRequired",
          "Base unit is required when default sales unit is set.",
        );
        throw createCrudFormError(message, { defaultSalesUnit: message });
      }
      if (derived.conversionInputs.length && !derived.defaultUnit) {
        const message = t(
          "catalog.products.uom.errors.baseRequiredForConversions",
          "Base unit is required when conversions are configured.",
        );
        throw createCrudFormError(message, { defaultUnit: message });
      }
      const defaultUnitKey = derived.defaultUnit?.toLowerCase() ?? null;
      const defaultSalesUnitKey = derived.defaultSalesUnit?.toLowerCase() ?? null;
      if (
        defaultUnitKey &&
        defaultSalesUnitKey &&
        defaultSalesUnitKey !== defaultUnitKey
      ) {
        const hasDefaultSalesConversion = derived.conversionInputs.some(
          (entry) =>
            entry.isActive && entry.unitCode.toLowerCase() === defaultSalesUnitKey,
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
      if (derived.unitPriceEnabled) {
        if (
          !derived.unitPriceReferenceUnit ||
          !UNIT_PRICE_REFERENCE_UNITS.has(
            derived.unitPriceReferenceUnit as ProductUnitPriceReferenceUnit,
          )
        ) {
          const message = t(
            "catalog.products.unitPrice.errors.referenceUnit",
            "Reference unit is required when unit price display is enabled.",
          );
          throw createCrudFormError(message, { unitPriceReferenceUnit: message });
        }
        if (derived.unitPriceBaseQuantity === null) {
          const message = t(
            "catalog.products.unitPrice.errors.baseQuantity",
            "Base quantity is required when unit price display is enabled.",
          );
          throw createCrudFormError(message, { unitPriceBaseQuantity: message });
        }
      }
    },
    buildPayload: ({ derived }) => ({
      defaultUnit: derived.defaultUnit ?? null,
      defaultSalesUnit: derived.defaultSalesUnit ?? derived.defaultUnit ?? null,
      defaultSalesUnitQuantity: derived.defaultSalesUnitQuantity,
      uomRoundingScale: derived.uomRoundingScale,
      uomRoundingMode: derived.uomRoundingMode,
      unitPriceEnabled: derived.unitPriceEnabled,
      unitPriceReferenceUnit: derived.unitPriceEnabled
        ? derived.unitPriceReferenceUnit
        : undefined,
      unitPriceBaseQuantity: derived.unitPriceEnabled
        ? derived.unitPriceBaseQuantity
        : undefined,
    }),
    // Conversions are their own records, synchronised after the product write
    // because they reference a product row whose base unit this same save may
    // have just changed.
    writeAfter: async ({ productId, derived, t, conversions, io }) => {
      const previousIds = new Set(
        conversions.loaded
          .map((entry) => (entry.id ?? "").trim())
          .filter((id) => id.length > 0),
      );
      const nextIds = new Set(
        derived.conversionInputs
          .map((entry) => (entry.id && entry.id.trim().length ? entry.id : null))
          .filter((id): id is string => Boolean(id)),
      );
      const removedIds = Array.from(previousIds).filter((id) => !nextIds.has(id));
      for (const conversionId of removedIds) {
        await io.withScopedApiRequestHeaders(
          io.buildOptimisticLockHeader(conversions.versions.get(conversionId) ?? null),
          () =>
            io.deleteCrud("catalog/product-unit-conversions", conversionId, {
              errorMessage: t(
                "catalog.products.uom.errors.sync",
                "Failed to synchronize product conversions.",
              ),
            }),
        );
      }
      const persisted: ConversionDraftLike[] = [];
      for (const conversion of derived.conversionInputs) {
        if (conversion.id) {
          const conversionId = conversion.id;
          await io.withScopedApiRequestHeaders(
            io.buildOptimisticLockHeader(conversions.versions.get(conversionId) ?? null),
            () =>
              io.updateCrud("catalog/product-unit-conversions", {
                id: conversionId,
                unitCode: conversion.unitCode,
                toBaseFactor: conversion.toBaseFactor,
                sortOrder: conversion.sortOrder,
                isActive: conversion.isActive,
              }),
          );
          persisted.push({
            id: conversion.id,
            unitCode: conversion.unitCode,
            toBaseFactor: String(conversion.toBaseFactor),
            sortOrder: String(conversion.sortOrder),
            isActive: conversion.isActive,
          });
          continue;
        }
        const created = await io.createCrud("catalog/product-unit-conversions", {
          productId,
          unitCode: conversion.unitCode,
          toBaseFactor: conversion.toBaseFactor,
          sortOrder: conversion.sortOrder,
          isActive: conversion.isActive,
        });
        const createdId =
          created.result &&
          typeof created.result === "object" &&
          typeof (created.result as { id?: unknown }).id === "string"
            ? (created.result as { id: string }).id
            : null;
        persisted.push({
          id: createdId,
          unitCode: conversion.unitCode,
          toBaseFactor: String(conversion.toBaseFactor),
          sortOrder: String(conversion.sortOrder),
          isActive: conversion.isActive,
        });
      }
      conversions.onPersisted(persisted);
    },
  },
  {
    id: "compliance",
    // The three date/quantity cross-field checks this section owns live on the
    // shared `productFormSchema`, not here: they pass on restored values, so a
    // hidden compliance card cannot block a save.
    ownedFields: [
      "countryOfOriginCode",
      "pkwiuCode",
      "cnCode",
      "hsCode",
      "taxClassificationCode",
      "gtuCodes",
      "ageMin",
      "isExciseGood",
      "exciseCategory",
      "requiresPrescription",
      "hazmatClass",
      "unNumber",
      "hazmatPackingGroup",
      "containsLithiumBattery",
      "launchAt",
      "endOfLifeAt",
      "availableFrom",
      "availableUntil",
      "minOrderQty",
      "maxOrderQty",
      "orderQtyIncrement",
      "requiresShipping",
      "isQuoteOnly",
      "seoTitle",
      "seoDescription",
      "canonicalUrl",
    ],
    buildPayload: ({ values }) => buildComplianceProductPayload(values),
  },
  {
    id: "variants",
    // Read-only here: variant records are created, edited and deleted through
    // their own routes inside the section, never through this form's submit.
    ownedFields: ["variants"],
  },
  {
    id: "meta",
    ownedFields: ["subtitle", "handle", "sku", "productType", "hasVariants", "taxRateId"],
    buildPayload: ({ values, derived }) => ({
      subtitle: values.subtitle?.trim() || undefined,
      handle: derived.handle,
      sku: values.sku?.trim() || null,
      productType: derived.productType,
      isConfigurable: derived.isConfigurable,
      taxRateId: derived.taxRateId,
      taxRate: derived.productTaxRateValue ?? null,
    }),
  },
  {
    id: "categorize",
    ownedFields: ["categoryIds", "channelIds", "tags"],
    buildPayload: ({ derived }) => ({
      categoryIds: derived.categoryIds,
      tags: derived.tags,
      offers: derived.offersPayload,
    }),
    // Channel de-selection deletes the offer record, so it has to happen before
    // the product write that stops referencing it.
    writeBefore: async ({ derived, offers, io }) => {
      const removed = offers.snapshots.filter(
        (offer) =>
          typeof offer.id === "string" && !derived.channelIds.includes(offer.channelId),
      );
      if (!removed.length) return;
      try {
        for (const offer of removed) {
          if (!offer.id) continue;
          const offerId = offer.id;
          // The offer's own version, overriding the product header the parent
          // CrudForm submit scope put on the stack (#2055).
          await io.withScopedApiRequestHeaders(
            io.buildOptimisticLockHeader(offer.updatedAt),
            () => io.deleteCrud("catalog/offers", offerId),
          );
        }
      } catch (err) {
        io.onOfferDeleteFailed(err);
      }
    },
    writeAfter: async ({ derived, offers }) => {
      offers.onPersisted(derived.offersPayload);
    },
  },
  {
    id: "custom-fields",
    ownedFields: ["customFieldsetCode"],
    buildPayload: ({ values, derived }) => {
      const payload: Record<string, unknown> = {
        customFieldsetCode: values.customFieldsetCode?.trim().length
          ? values.customFieldsetCode
          : undefined,
      };
      if (Object.keys(derived.customFields).length) {
        payload.customFields = derived.customFields;
      }
      return payload;
    },
  },
];

const SECTIONS_BY_ID = new Map(
  CATALOG_PRODUCT_FORM_SECTIONS.map((section) => [section.id, section]),
);

export function getCatalogProductFormSection(
  id: CatalogProductFormSectionId,
): CatalogProductFormSection | undefined {
  return SECTIONS_BY_ID.get(id);
}

export function isCatalogProductFormSectionId(
  value: string,
): value is CatalogProductFormSectionId {
  return SECTIONS_BY_ID.has(value as CatalogProductFormSectionId);
}

/**
 * Turn an app's `overrides.forms.sections` policy into the set of built-in
 * sections this form must hide.
 *
 * Two kinds of bad input are rejected here rather than forwarded:
 *
 * - **Unknown ids** are ignored with a development warning. A stale id after an
 *   upstream rename must never white-screen a product page; the worst outcome
 *   of a typo is that nothing is hidden.
 * - **`widget:<widgetId>` ids** are refused outright, because hiding an
 *   injection widget's *card* leaves its `onBeforeSave` / `transformFormData`
 *   handlers registered against the spot. The result is a save blocked by a
 *   control that is not in the DOM, with nothing to scroll to — strictly worse
 *   than not hiding it. The diagnostic names the mechanism that does work.
 */
export function resolveHiddenCatalogProductSections(
  policy: { hidden?: readonly string[] } | null | undefined,
  options: { onDiagnostic?: (message: string, details: Record<string, unknown>) => void } = {},
): ReadonlySet<CatalogProductFormSectionId> {
  const hidden = policy?.hidden
  if (!Array.isArray(hidden) || hidden.length === 0) return EMPTY_HIDDEN_SECTIONS

  const resolved = new Set<CatalogProductFormSectionId>()
  const unknown: string[] = []
  const widgetIds: string[] = []

  for (const raw of hidden) {
    if (typeof raw !== "string") continue
    const id = raw.trim()
    if (!id) continue
    if (id.startsWith("widget:")) {
      widgetIds.push(id)
      continue
    }
    if (isCatalogProductFormSectionId(id)) {
      resolved.add(id)
      continue
    }
    unknown.push(id)
  }

  const report = options.onDiagnostic
  if (report) {
    if (unknown.length) {
      report(
        "[internal] forms.sections named unknown catalog product section ids — ignoring them",
        { hostId: CATALOG_PRODUCT_FORM_HOST_ID, unknownIds: unknown, knownIds: [...CATALOG_PRODUCT_FORM_SECTION_IDS] },
      )
    }
    if (widgetIds.length) {
      report(
        "[internal] forms.sections cannot hide injection widget cards — hiding one would leave its save-time handlers running",
        {
          hostId: CATALOG_PRODUCT_FORM_HOST_ID,
          widgetIds,
          use: "overrides.widgets.injection['<widgetId>'] = null",
        },
      )
    }
  }

  return resolved
}

const EMPTY_HIDDEN_SECTIONS: ReadonlySet<CatalogProductFormSectionId> = new Set()

/**
 * Reset every field owned by a hidden section back to its loaded value.
 *
 * This single rule is what makes hiding coherent, and both guarantees fall out
 * of it rather than needing separate mechanisms:
 *
 * - *No unreachable validation error.* The stored record is by construction
 *   something the server accepted, so a hidden section's restored fields cannot
 *   fail the shared `productFormSchema` on a control the user cannot see.
 * - *Stored data preserved.* A hidden section contributes no payload key, and
 *   because its values were restored first, nothing a stale edit left behind can
 *   leak into a key some other section happens to own.
 *
 * Restoring to the **loaded** values rather than to blank defaults is
 * deliberate: visible sections legitimately read hidden ones (the option-schema
 * title comes from `details`, the offer fallback from `details` too), and blank
 * defaults would feed them an empty string.
 */
export function restoreHiddenSectionFields(
  values: ProductFormValues,
  hiddenSectionIds: ReadonlySet<CatalogProductFormSectionId>,
  loadedValues: ProductFormValues | null | undefined,
): ProductFormValues {
  if (hiddenSectionIds.size === 0) return values
  const restored: ProductFormValues = { ...values }
  for (const section of CATALOG_PRODUCT_FORM_SECTIONS) {
    if (!hiddenSectionIds.has(section.id)) continue
    for (const field of section.ownedFields) {
      // Nothing loaded for this field (a record predating it, say) leaves the
      // current value in place: the section contributes no payload key either
      // way, so this only affects what a visible section may read.
      if (!loadedValues || !(field in loadedValues)) continue
      ;(restored as Record<string, unknown>)[field as string] = (
        loadedValues as Record<string, unknown>
      )[field as string]
    }
  }
  return restored
}
