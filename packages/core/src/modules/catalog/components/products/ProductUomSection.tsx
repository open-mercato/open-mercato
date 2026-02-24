"use client";

import * as React from "react";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { Button } from "@open-mercato/ui/primitives/button";
import { Checkbox } from "@open-mercato/ui/primitives/checkbox";
import { Input } from "@open-mercato/ui/primitives/input";
import { Label } from "@open-mercato/ui/primitives/label";
import { Spinner } from "@open-mercato/ui/primitives/spinner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type {
  ProductFormValues,
  ProductUnitConversionDraft,
} from "./productForm";
import { createProductUnitConversionDraft } from "./productForm";
import { REFERENCE_UNIT_CODES } from "@open-mercato/shared/lib/units/unitCodes";
import { toTrimmedOrNull } from "./productFormUtils";

type UnitDictionaryEntry = {
  id?: string;
  value?: string;
  label?: string;
};

type UnitDictionaryResponse = {
  entries?: UnitDictionaryEntry[];
};

type UnitOption = {
  value: string;
  label: string;
};

type ProductUomSectionProps = {
  values: ProductFormValues;
  errors: Record<string, string>;
  setValue: (id: string, value: unknown) => void;
  embedded?: boolean;
};

const REFERENCE_UNIT_DISPLAY: Record<string, string> = {
  kg: "1 kg", l: "1 l", m2: "1 m\u00B2", m3: "1 m\u00B3", pc: "1 pc",
};
const REFERENCE_UNIT_OPTIONS = REFERENCE_UNIT_CODES.map((code) => ({
  value: code,
  i18nKey: `catalog.products.unitPrice.options.${code}` as const,
  fallback: REFERENCE_UNIT_DISPLAY[code] ?? code,
}));

const normalizeText = toTrimmedOrNull;

function normalizeDecimalInput(value: string): string {
  return value.replace(/,/g, ".");
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const numeric = Number(normalized.replace(",", "."));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function toSortValue(value: string): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function formatPreviewNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toString();
}

function normalizeConversions(value: unknown): ProductUnitConversionDraft[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as ProductUnitConversionDraft;
      return {
        id: normalizeText(row.id) ?? null,
        unitCode: normalizeText(row.unitCode) ?? "",
        toBaseFactor: normalizeText(row.toBaseFactor)
          ? normalizeDecimalInput(normalizeText(row.toBaseFactor) as string)
          : "",
        sortOrder: normalizeText(row.sortOrder) ?? "",
        isActive: row.isActive !== false,
      } satisfies ProductUnitConversionDraft;
    })
    .filter((entry): entry is ProductUnitConversionDraft => Boolean(entry));
  normalized.sort((left, right) => {
    const leftOrder = toSortValue(left.sortOrder);
    const rightOrder = toSortValue(right.sortOrder);
    if (leftOrder === rightOrder) return left.unitCode.localeCompare(right.unitCode);
    return leftOrder - rightOrder;
  });
  return normalized.map((entry, index) => ({
    ...entry,
    sortOrder: String((index + 1) * 10),
  }));
}

function buildUnitOptions(
  entries: UnitDictionaryEntry[] | undefined,
): UnitOption[] {
  const list = Array.isArray(entries) ? entries : [];
  const options = list
    .map((entry) => {
      const value = normalizeText(entry.value);
      if (!value) return null;
      return {
        value,
        label: normalizeText(entry.label) ?? value,
      } satisfies UnitOption;
    })
    .filter((entry): entry is UnitOption => Boolean(entry));
  return options.sort((left, right) => left.label.localeCompare(right.label));
}

export function ProductUomSection({
  values,
  errors,
  setValue,
  embedded = false,
}: ProductUomSectionProps) {
  const t = useT();
  const [unitOptions, setUnitOptions] = React.useState<UnitOption[]>([]);
  const [loadingUnits, setLoadingUnits] = React.useState(false);
  const [errorLoadingUnits, setErrorLoadingUnits] = React.useState(false);
  const conversions = React.useMemo(
    () => normalizeConversions(values.unitConversions),
    [values.unitConversions],
  );

  React.useEffect(() => {
    let cancelled = false;
    async function loadUnits() {
      setLoadingUnits(true);
      setErrorLoadingUnits(false);
      try {
        const response = await apiCall<UnitDictionaryResponse>(
          "/api/catalog/dictionaries/unit",
          undefined,
          { fallback: { entries: [] } },
        );
        if (cancelled) return;
        setUnitOptions(buildUnitOptions(response.result?.entries));
      } catch {
        if (!cancelled) {
          setUnitOptions([]);
          setErrorLoadingUnits(true);
        }
      } finally {
        if (!cancelled) setLoadingUnits(false);
      }
    }
    void loadUnits();
    return () => {
      cancelled = true;
    };
  }, []);

  const findUnitLabel = React.useCallback(
    (value: string | null | undefined) => {
      const code = normalizeText(value);
      if (!code) return null;
      const option = unitOptions.find((entry) => entry.value === code);
      return option?.label ?? code;
    },
    [unitOptions],
  );

  const setConversions = React.useCallback(
    (next: ProductUnitConversionDraft[]) => {
      const normalized = next.map((entry, index) => ({
        ...entry,
        sortOrder: String((index + 1) * 10),
      }));
      setValue("unitConversions", normalized);
    },
    [setValue],
  );

  const addConversion = React.useCallback(() => {
    const next = [
      ...conversions,
      createProductUnitConversionDraft({
        sortOrder: String((conversions.length + 1) * 10),
      }),
    ];
    setConversions(next);
  }, [conversions, setConversions]);

  const updateConversion = React.useCallback(
    (index: number, patch: Partial<ProductUnitConversionDraft>) => {
      const next = conversions.map((entry, rowIndex) =>
        rowIndex === index ? { ...entry, ...patch } : entry,
      );
      setConversions(next);
    },
    [conversions, setConversions],
  );

  const removeConversion = React.useCallback(
    (index: number) => {
      const next = conversions.filter((_entry, rowIndex) => rowIndex !== index);
      setConversions(next);
    },
    [conversions, setConversions],
  );

  const moveConversion = React.useCallback(
    (index: number, direction: "up" | "down") => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= conversions.length) return;
      const next = [...conversions];
      const source = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = source;
      setConversions(next);
    },
    [conversions, setConversions],
  );

  const defaultUnit = normalizeText(values.defaultUnit) ?? "";
  const defaultSalesUnit = normalizeText(values.defaultSalesUnit) ?? "";
  const defaultSalesQuantityRaw =
    normalizeText(values.defaultSalesUnitQuantity) ?? "1";
  const defaultSalesQuantity = normalizeDecimalInput(defaultSalesQuantityRaw);
  const unitPriceEnabled = Boolean(values.unitPriceEnabled);
  const unitPriceReferenceUnit =
    normalizeText(values.unitPriceReferenceUnit) ?? "";
  const unitPriceBaseQuantityRaw =
    normalizeText(values.unitPriceBaseQuantity) ?? "";
  const unitPriceBaseQuantity = normalizeDecimalInput(unitPriceBaseQuantityRaw);

  const baseUnitLabel = findUnitLabel(defaultUnit) ?? defaultUnit;
  const salesUnitLabel =
    findUnitLabel(defaultSalesUnit || defaultUnit) ??
    defaultSalesUnit ??
    defaultUnit;

  const defaultSalesFactor = React.useMemo(() => {
    const defaultUnitKey = defaultUnit.toLowerCase();
    const defaultSalesKey = (defaultSalesUnit || defaultUnit).toLowerCase();
    if (!defaultUnitKey || !defaultSalesKey) return null;
    if (defaultSalesKey === defaultUnitKey) return 1;
    const row = conversions.find(
      (entry) =>
        entry.isActive &&
        entry.unitCode.toLowerCase() === defaultSalesKey &&
        toPositiveNumber(entry.toBaseFactor) !== null,
    );
    return row ? toPositiveNumber(row.toBaseFactor) : null;
  }, [conversions, defaultSalesUnit, defaultUnit]);

  const defaultSalesQuantityNumber = toPositiveNumber(defaultSalesQuantity);
  const defaultSalesQuantityNormalized =
    defaultSalesQuantityNumber && defaultSalesFactor
      ? defaultSalesQuantityNumber * defaultSalesFactor
      : null;
  const unitPriceBaseQuantityNumber = toPositiveNumber(unitPriceBaseQuantity);

  const validConversions = conversions.filter(
    (entry) =>
      normalizeText(entry.unitCode) && normalizeText(entry.toBaseFactor),
  );
  const conversionPreviewItems = validConversions
    .slice(0, 3)
    .map((entry) => {
      const label = findUnitLabel(entry.unitCode) ?? entry.unitCode;
      const baseLabel = findUnitLabel(defaultUnit) ?? defaultUnit;
      const factor = normalizeText(entry.toBaseFactor) ?? "1";
      return `1 ${label} = ${factor} ${baseLabel || t("catalog.products.uom.baseUnit", "base unit")}`;
    });
  const conversionPreview =
    validConversions.length > 3
      ? `${conversionPreviewItems.join(" • ")} (+${validConversions.length - 3})`
      : conversionPreviewItems.join(" • ");

  return (
    <div
      className={
        embedded ? "space-y-5" : "space-y-5 rounded-lg border bg-card p-4"
      }
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">
          {t("catalog.products.uom.title", "Units of measure")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t(
            "catalog.products.uom.description",
            "Set base unit, sales unit, and packaging conversions.",
          )}
        </p>
      </div>

      {loadingUnits ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="h-3 w-3" />
          {t("catalog.products.uom.loadingUnits", "Loading units...")}
        </div>
      ) : null}

      {errorLoadingUnits ? (
        <p className="text-xs text-destructive">
          {t(
            "catalog.products.uom.errors.loadUnits",
            "Failed to load units. Please try refreshing the page.",
          )}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="catalog-product-uom-base-unit">{t("catalog.products.uom.baseUnit", "Base unit")}</Label>
          <select
            id="catalog-product-uom-base-unit"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={defaultUnit}
            onChange={(event) =>
              setValue("defaultUnit", event.target.value || null)
            }
            disabled={loadingUnits}
          >
            <option value="">
              {t("catalog.products.uom.selectUnit", "Select unit")}
            </option>
            {unitOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.defaultUnit ? (
            <p className="text-xs text-destructive">{errors.defaultUnit}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="catalog-product-uom-sales-unit">
            {t("catalog.products.uom.defaultSalesUnit", "Default sales unit")}
          </Label>
          <select
            id="catalog-product-uom-sales-unit"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={defaultSalesUnit}
            onChange={(event) =>
              setValue("defaultSalesUnit", event.target.value || null)
            }
            disabled={loadingUnits}
          >
            <option value="">
              {t("catalog.products.uom.selectUnit", "Select unit")}
            </option>
            {unitOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.defaultSalesUnit ? (
            <p className="text-xs text-destructive">{errors.defaultSalesUnit}</p>
          ) : null}
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="catalog-product-uom-default-sales-quantity">
            {t(
              "catalog.products.uom.defaultSalesQuantityLabel",
              "Default line quantity (in sales unit)",
            )}
          </Label>
          <Input
            id="catalog-product-uom-default-sales-quantity"
            type="text"
            inputMode="decimal"
            value={defaultSalesQuantity}
            onChange={(event) =>
              setValue(
                "defaultSalesUnitQuantity",
                normalizeDecimalInput(event.target.value),
              )
            }
            placeholder="1"
          />
          <p className="text-xs text-muted-foreground">
            {t(
              "catalog.products.uom.defaultSalesQuantityHint",
              "Used to prefill quantity in quote/order lines. Value is interpreted in Default sales unit.",
            )}
          </p>
          {defaultSalesQuantityNumber && salesUnitLabel ? (
            <p className="text-xs text-muted-foreground">
              {defaultSalesQuantityNormalized && baseUnitLabel
                ? t(
                    "catalog.products.uom.defaultSalesQuantityPreviewWithNormalization",
                    "Default line: {{quantity}} {{salesUnit}} (= {{normalized}} {{baseUnit}}).",
                    {
                      quantity: formatPreviewNumber(defaultSalesQuantityNumber),
                      salesUnit: salesUnitLabel,
                      normalized: formatPreviewNumber(
                        defaultSalesQuantityNormalized,
                      ),
                      baseUnit: baseUnitLabel,
                    },
                  )
                : t(
                    "catalog.products.uom.defaultSalesQuantityPreview",
                    "Default line: {{quantity}} {{salesUnit}}.",
                    {
                      quantity: formatPreviewNumber(defaultSalesQuantityNumber),
                      salesUnit: salesUnitLabel,
                    },
                  )}
            </p>
          ) : null}
          {errors.defaultSalesUnitQuantity ? (
            <p className="text-xs text-destructive">
              {errors.defaultSalesUnitQuantity}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="catalog-product-uom-rounding-mode">
            {t("catalog.products.uom.roundingMode", "Rounding mode")}
          </Label>
          <select
            id="catalog-product-uom-rounding-mode"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={values.uomRoundingMode ?? "half_up"}
            onChange={(event) =>
              setValue("uomRoundingMode", event.target.value)
            }
          >
            <option value="half_up">
              {t("catalog.products.uom.roundingModeHalfUp", "Half up (default)")}
            </option>
            <option value="down">
              {t("catalog.products.uom.roundingModeDown", "Round down")}
            </option>
            <option value="up">
              {t("catalog.products.uom.roundingModeUp", "Round up")}
            </option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="catalog-product-uom-rounding-scale">
            {t("catalog.products.uom.roundingScale", "Rounding scale (decimal places)")}
          </Label>
          <Input
            id="catalog-product-uom-rounding-scale"
            type="number"
            min={0}
            max={6}
            value={values.uomRoundingScale ?? 4}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              setValue("uomRoundingScale", Number.isFinite(parsed) ? Math.max(0, Math.min(6, parsed)) : 4);
            }}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="catalog-product-unit-price-enabled"
            checked={unitPriceEnabled}
            onCheckedChange={(checked) =>
              setValue("unitPriceEnabled", checked === true)
            }
          />
          <Label
            htmlFor="catalog-product-unit-price-enabled"
            className="text-sm"
          >
            {t(
              "catalog.products.unitPrice.enable",
              "Enable EU unit price display",
            )}
          </Label>
        </div>

        {unitPriceEnabled ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="catalog-product-uom-reference-unit">
                {t(
                  "catalog.products.unitPrice.referenceUnit",
                  "Reference unit",
                )}
              </Label>
              <select
                id="catalog-product-uom-reference-unit"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={unitPriceReferenceUnit}
                onChange={(event) =>
                  setValue("unitPriceReferenceUnit", event.target.value || null)
                }
              >
                <option value="">
                  {t(
                    "catalog.products.unitPrice.selectReferenceUnit",
                    "Select reference unit",
                  )}
                </option>
                {REFERENCE_UNIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.i18nKey, option.fallback)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="catalog-product-uom-unit-price-base-quantity">
                {t(
                  "catalog.products.unitPrice.baseQuantity",
                  "Reference quantity (in base unit)",
                )}
              </Label>
              <Input
                id="catalog-product-uom-unit-price-base-quantity"
                type="text"
                inputMode="decimal"
                value={unitPriceBaseQuantity}
                onChange={(event) =>
                  setValue(
                    "unitPriceBaseQuantity",
                    normalizeDecimalInput(event.target.value),
                  )
                }
                placeholder="1"
              />
            </div>
          </div>
        ) : null}
        {unitPriceEnabled ? (
          <p className="text-xs text-muted-foreground">
            {unitPriceReferenceUnit && unitPriceBaseQuantityNumber
              ? t(
                  "catalog.products.unitPrice.hintWithPreview",
                  "Show calculated price per {{quantity}} {{unit}}. For most products use 1 (for example: 1 kg, 1 l, 1 m²).",
                  {
                    quantity: formatPreviewNumber(unitPriceBaseQuantityNumber),
                    unit: unitPriceReferenceUnit,
                  },
                )
              : t(
                  "catalog.products.unitPrice.hint",
                  "Show calculated price per selected reference unit. In most cases set quantity to 1.",
                )}
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">
            {t("catalog.products.uom.conversions", "Product conversions")}
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addConversion}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("catalog.products.uom.addConversion", "Add conversion")}
          </Button>
        </div>

        {conversions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t(
              "catalog.products.uom.emptyConversions",
              "No conversions configured yet.",
            )}
          </p>
        ) : (
          <div className="space-y-2">
            {conversions.map((entry, index) => (
              <div
                key={entry.id ?? `uom-conversion-${index}`}
                className="grid gap-3 rounded-md border p-3 md:grid-cols-12"
              >
                <div className="space-y-1 md:col-span-4">
                  <Label htmlFor={`catalog-product-uom-conversion-unit-${index}`} className="text-xs text-muted-foreground">
                    {t("catalog.products.uom.conversionUnit", "Sales unit")}
                  </Label>
                  <select
                    id={`catalog-product-uom-conversion-unit-${index}`}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={entry.unitCode}
                    onChange={(event) =>
                      updateConversion(index, { unitCode: event.target.value })
                    }
                    disabled={loadingUnits}
                  >
                    <option value="">
                      {t("catalog.products.uom.selectUnit", "Select unit")}
                    </option>
                    {unitOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1 md:col-span-3">
                  <Label htmlFor={`catalog-product-uom-conversion-factor-${index}`} className="text-xs text-muted-foreground">
                    {t(
                      "catalog.products.uom.toBaseFactor",
                      "Base units per 1 sales unit",
                    )}
                  </Label>
                  <Input
                    id={`catalog-product-uom-conversion-factor-${index}`}
                    type="text"
                    inputMode="decimal"
                    value={entry.toBaseFactor}
                    onChange={(event) =>
                      updateConversion(index, {
                        toBaseFactor: normalizeDecimalInput(event.target.value),
                      })
                    }
                    placeholder="1"
                  />
                </div>

                <div className="flex items-end gap-2 md:col-span-3">
                  <div className="inline-flex h-9 rounded-md border">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-none border-r"
                      onClick={() => moveConversion(index, "up")}
                      disabled={index === 0}
                      aria-label={t(
                        "catalog.products.uom.moveUp",
                        "Move conversion up",
                      )}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-none"
                      onClick={() => moveConversion(index, "down")}
                      disabled={index === conversions.length - 1}
                      aria-label={t(
                        "catalog.products.uom.moveDown",
                        "Move conversion down",
                      )}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                  <label
                    htmlFor={`catalog-product-uom-conversion-active-${index}`}
                    className="flex items-center gap-2 px-1 text-xs text-muted-foreground"
                  >
                    <Checkbox
                      id={`catalog-product-uom-conversion-active-${index}`}
                      checked={entry.isActive}
                      onCheckedChange={(checked) =>
                        updateConversion(index, { isActive: checked === true })
                      }
                    />
                    {t("catalog.products.uom.active", "Active")}
                  </label>
                </div>

                <div className="flex items-end justify-end md:col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => removeConversion(index)}
                    aria-label={t(
                      "catalog.products.uom.removeConversion",
                      "Remove conversion",
                    )}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {(() => {
                  const factor = toPositiveNumber(entry.toBaseFactor);
                  if (!entry.unitCode || factor === null) return null;
                  return (
                  <p className="text-xs text-muted-foreground md:col-span-12">
                    {t(
                      "catalog.products.uom.conversionPreview",
                      "1 {{fromUnit}} = {{factor}} {{baseUnit}}",
                      {
                        fromUnit: findUnitLabel(entry.unitCode) ?? entry.unitCode,
                        factor: formatPreviewNumber(factor),
                        baseUnit:
                          findUnitLabel(defaultUnit) ??
                          defaultUnit ??
                          t("catalog.products.uom.baseUnit", "base unit"),
                      },
                    )}
                  </p>
                  );
                })()}
              </div>
            ))}
          </div>
        )}

        {conversions.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            {t(
              "catalog.products.uom.conversionOrderHint",
              "Use arrows to reorder conversion priority.",
            )}
          </p>
        ) : null}

        {conversionPreview ? (
          <p className="text-xs text-muted-foreground">{conversionPreview}</p>
        ) : null}
      </div>
    </div>
  );
}
