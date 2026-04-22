"use client";

import * as React from "react";
import {
  LookupSelect,
  type LookupSelectItem,
} from "@open-mercato/ui/backend/inputs";
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
  type CrudCustomFieldRenderProps,
} from "@open-mercato/ui/backend/CrudForm";
import { collectCustomFieldValues } from "@open-mercato/ui/backend/utils/customFieldValues";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { createCrud, updateCrud } from "@open-mercato/ui/backend/utils/crud";
import { createCrudFormError } from "@open-mercato/ui/backend/utils/serverErrors";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@open-mercato/ui/primitives/dialog";
import { Button } from "@open-mercato/ui/primitives/button";
import { Input } from "@open-mercato/ui/primitives/input";
import { DollarSign, Settings } from "lucide-react";
import { normalizeCustomFieldValues } from "@open-mercato/shared/lib/custom-fields/normalize";
import {
  DictionaryValue,
  renderDictionaryIcon,
  renderDictionaryColor,
} from "@open-mercato/core/modules/dictionaries/components/dictionaryAppearance";
import { E } from "#generated/entities.ids.generated";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { useOrganizationScopeDetail } from "@open-mercato/shared/lib/frontend/useOrganizationScope";
import { formatMoney, normalizeNumber } from "./lineItemUtils";
import type { SalesLineRecord } from "./lineItemTypes";
import {
  normalizeCustomFieldSubmitValue,
  extractCustomFieldValues,
} from "./customFieldHelpers";
import { canonicalizeUnitCode } from "@open-mercato/shared/lib/units/unitCodes";

type ProductOption = {
  id: string;
  title: string;
  sku: string | null;
  thumbnailUrl: string | null;
  taxRateId?: string | null;
  taxRate?: number | null;
  defaultUnit?: string | null;
  defaultSalesUnit?: string | null;
  defaultSalesUnitQuantity?: number | null;
};

type VariantOption = {
  id: string;
  title: string;
  sku: string | null;
  thumbnailUrl: string | null;
  taxRateId?: string | null;
  taxRate?: number | null;
};

type PriceOption = {
  id: string;
  amountNet: number | null;
  amountGross: number | null;
  currencyCode: string | null;
  displayMode: "including-tax" | "excluding-tax" | null;
  taxRate: number | null;
  label: string;
  priceKindId?: string | null;
  priceKindTitle?: string | null;
  priceKindCode?: string | null;
  scopeReason?: string | null;
  scopeTags?: string[];
};

type TaxRateOption = {
  id: string;
  name: string;
  code: string | null;
  rate: number | null;
  isDefault: boolean;
};

type StatusOption = {
  id: string;
  value: string;
  label: string;
  color: string | null;
  icon: string | null;
};

type UnitOption = {
  code: string;
  toBaseFactor: number | null;
  isBase: boolean;
};

type LineFormState = {
  lineMode: "catalog" | "custom";
  productId: string | null;
  variantId: string | null;
  quantity: string;
  quantityUnit: string | null;
  priceId: string | null;
  priceMode: "net" | "gross";
  unitPrice: string;
  taxRate: number | null;
  taxRateId: string | null;
  name: string;
  currencyCode: string | null;
  catalogSnapshot?: Record<string, unknown> | null;
  customFieldSetId?: string | null;
  statusEntryId?: string | null;
};

type FieldRenderProps = CrudCustomFieldRenderProps;

type ApiPriceKind = {
  title?: string | null;
  name?: string | null;
  code?: string | null;
};

type ApiPriceItem = Record<string, unknown> & {
  unit_price_net?: number | null;
  unit_price_gross?: number | null;
  currency_code?: string | null;
  currencyCode?: string | null;
  display_mode?: string | null;
  displayMode?: string | null;
  tax_rate?: number | null;
  price_kind_id?: string | null;
  priceKindId?: string | null;
  price_kind_title?: string | null;
  priceKindTitle?: string | null;
  price_kind_code?: string | null;
  priceKindCode?: string | null;
  price_kind?: ApiPriceKind | null;
  kind?: string | null;
};

type ApiTaxRateItem = Record<string, unknown> & {
  rate?: number | null;
  code?: string | null;
  isDefault?: boolean;
  is_default?: boolean;
  min_quantity?: number | null;
  max_quantity?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
};

type ApiProductItem = Record<string, unknown> & {
  name?: string;
  sku?: string;
  default_media_url?: string;
  defaultMediaUrl?: string;
  pricing?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  tax_rate?: number | null;
  taxRate?: number | null;
};

type ApiVariantItem = Record<string, unknown> & {
  sku?: string;
  default_media_url?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown> | null;
  tax_rate?: number | null;
  taxRate?: number | null;
};

type ApiPricingMetadata = {
  tax_rate_id?: string;
  taxRateId?: string;
  tax_rate?: number | null;
  taxRate?: number | null;
};

type LineMetadataRecord = {
  lineMode?: string;
  customLine?: boolean | null;
  priceMode?: string;
  taxRateId?: string;
  priceId?: string;
  productTitle?: string;
  productSku?: string;
  productThumbnail?: string;
  variantTitle?: string;
  variantSku?: string;
  variantThumbnail?: string;
};

type CatalogSnapshotRecord = Record<string, unknown> & {
  product?: Record<string, unknown> | null;
  variant?: Record<string, unknown> | null;
};

type SnapshotEntity = {
  title?: string;
  sku?: string;
  thumbnailUrl?: string;
  thumbnail_url?: string;
  taxRate?: number | null;
  taxRateId?: string;
};

type SalesLineDialogProps = {
  open: boolean;
  kind: "order" | "quote";
  documentId: string;
  currencyCode: string | null | undefined;
  organizationId: string | null;
  tenantId: string | null;
  initialLine?: SalesLineRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => Promise<void> | void;
};

const defaultForm = (currencyCode?: string | null): LineFormState => ({
  lineMode: "catalog",
  productId: null,
  variantId: null,
  quantity: "1",
  quantityUnit: null,
  priceId: null,
  priceMode: "gross",
  unitPrice: "",
  taxRate: null,
  taxRateId: null,
  name: "",
  currencyCode: currencyCode ?? null,
  catalogSnapshot: null,
  customFieldSetId: null,
  statusEntryId: null,
});

const UNIT_PRICE_INPUT_SCALE = 4;

function buildPriceScopeReason(
  item: Record<string, unknown>,
  t: (k: string, f: string) => string,
): {
  reason: string | null;
  tags: string[];
} {
  const tags: string[] = [];
  const add = (key: string) => tags.push(key);
  if (item.channel_id || item.channelId)
    add(t("sales.documents.items.priceScope.channel", "Channel"));
  if (item.offer_id || item.offerId)
    add(t("sales.documents.items.priceScope.offer", "Offer"));
  if (item.variant_id || item.variantId)
    add(t("sales.documents.items.priceScope.variant", "Variant"));
  if (item.customer_group_id || item.customerGroupId)
    add(t("sales.documents.items.priceScope.customerGroup", "Customer group"));
  if (item.customer_id || item.customerId)
    add(t("sales.documents.items.priceScope.customer", "Customer"));
  if (item.user_group_id || item.userGroupId)
    add(t("sales.documents.items.priceScope.userGroup", "User group"));
  if (item.user_id || item.userId)
    add(t("sales.documents.items.priceScope.user", "User"));
  const minQty = normalizeNumber((item as ApiPriceItem).min_quantity, Number.NaN);
  const maxQty = normalizeNumber((item as ApiPriceItem).max_quantity, Number.NaN);
  if (Number.isFinite(minQty) || Number.isFinite(maxQty)) {
    add(t("sales.documents.items.priceScope.quantity", "Quantity"));
  }
  if ((item as ApiPriceItem).starts_at || (item as ApiPriceItem).ends_at) {
    add(t("sales.documents.items.priceScope.schedule", "Scheduled"));
  }
  if (tags.length === 0) return { reason: null, tags };
  return { reason: tags.join(" • "), tags };
}

function buildPlaceholder(label?: string | null) {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded border bg-muted text-[10px] uppercase text-muted-foreground">
      {(label ?? "").slice(0, 2) || "•"}
    </div>
  );
}

function normalizeUnitCode(value: unknown): string | null {
  return canonicalizeUnitCode(value);
}

function getRecordBoolean(
  record: Record<string, unknown>,
  fallback: boolean,
  ...keys: string[]
): boolean {
  for (const key of keys) {
    const val = record[key];
    if (typeof val === "boolean") return val;
  }
  return fallback;
}

function getUomProductFields(item: Record<string, unknown>) {
  return {
    defaultUnit: normalizeUnitCode(item.default_unit ?? item.defaultUnit),
    defaultSalesUnit: normalizeUnitCode(
      item.default_sales_unit ?? item.defaultSalesUnit,
    ),
    defaultSalesUnitQuantity: normalizeNumber(
      item.default_sales_unit_quantity ?? item.defaultSalesUnitQuantity,
      Number.NaN,
    ),
  };
}

function getUomConversionFields(row: Record<string, unknown>) {
  return {
    unitCode: normalizeUnitCode(row.unit_code ?? row.unitCode),
    isActive: getRecordBoolean(row, true, "is_active", "isActive"),
    toBaseFactor: normalizeNumber(
      row.to_base_factor ?? row.toBaseFactor,
      Number.NaN,
    ),
  };
}

function normalizeQuantityPreview(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeUnitPriceInputValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  const factor = 10 ** UNIT_PRICE_INPUT_SCALE;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  if (!Number.isFinite(rounded)) return "";
  return rounded.toString();
}

export function LineItemDialog({
  open,
  kind,
  documentId,
  currencyCode,
  organizationId,
  tenantId,
  initialLine,
  onOpenChange,
  onSaved,
}: SalesLineDialogProps) {
  const t = useT();
  const scope = useOrganizationScopeDetail();
  const resolvedOrganizationId = organizationId ?? scope.organizationId ?? null;
  const resolvedTenantId = tenantId ?? scope.tenantId ?? null;
  const [initialValues, setInitialValues] = React.useState<LineFormState>(() =>
    defaultForm(currencyCode),
  );
  const [lineMode, setLineMode] = React.useState<"catalog" | "custom">(
    defaultForm(currencyCode).lineMode,
  );
  const [productOption, setProductOption] =
    React.useState<ProductOption | null>(null);
  const [variantOption, setVariantOption] =
    React.useState<VariantOption | null>(null);
  const [priceOptions, setPriceOptions] = React.useState<PriceOption[]>([]);
  const [priceLoading, setPriceLoading] = React.useState(false);
  const [formResetKey, setFormResetKey] = React.useState(0);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [taxRates, setTaxRates] = React.useState<TaxRateOption[]>([]);
  const [lineStatuses, setLineStatuses] = React.useState<StatusOption[]>([]);
  const [unitOptions, setUnitOptions] = React.useState<UnitOption[]>([]);
  const [, setLineStatusLoading] = React.useState(false);
  const productOptionsRef = React.useRef<Map<string, ProductOption>>(new Map());
  const variantOptionsRef = React.useRef<Map<string, VariantOption>>(new Map());
  const taxRatesRef = React.useRef<TaxRateOption[]>([]);
  const defaultTaxRateRef = React.useRef<TaxRateOption | null>(null);
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null);

  const resourcePath = React.useMemo(
    () => (kind === "order" ? "sales/order-lines" : "sales/quote-lines"),
    [kind],
  );
  const documentKey = kind === "order" ? "orderId" : "quoteId";
  const customFieldEntityId =
    kind === "order" ? E.sales.sales_order_line : E.sales.sales_quote_line;

  const taxRateMap = React.useMemo(
    () =>
      taxRates.reduce<Map<string, TaxRateOption>>((acc, rate) => {
        acc.set(rate.id, rate);
        return acc;
      }, new Map()),
    [taxRates],
  );

  const findTaxRateIdByValue = React.useCallback(
    (value: number | null | undefined): string | null => {
      const numeric = normalizeNumber(value, Number.NaN);
      if (!Number.isFinite(numeric)) return null;
      const match = taxRatesRef.current.find(
        (rate) =>
          Number.isFinite(rate.rate) &&
          Math.abs((rate.rate as number) - numeric) < 0.0001,
      );
      return match?.id ?? null;
    },
    [],
  );

  const resolveTaxSelection = React.useCallback(
    (
      source?: { taxRateId?: string | null; taxRate?: number | null } | null,
    ) => {
      const taxRateId =
        typeof source?.taxRateId === "string" && source.taxRateId.trim().length
          ? source.taxRateId.trim()
          : null;
      const rateFromId = taxRateId
        ? normalizeNumber(taxRateMap.get(taxRateId)?.rate, Number.NaN)
        : Number.NaN;
      const numericRate = normalizeNumber(source?.taxRate, Number.NaN);
      const resolvedRateId =
        taxRateId ??
        (Number.isFinite(numericRate)
          ? findTaxRateIdByValue(numericRate)
          : null);
      const resolvedRate = Number.isFinite(rateFromId)
        ? rateFromId
        : Number.isFinite(numericRate)
          ? numericRate
          : null;
      return { taxRateId: resolvedRateId, taxRate: resolvedRate };
    },
    [findTaxRateIdByValue, taxRateMap],
  );

  const hasTaxMetadata = React.useCallback(
    (
      source?: { taxRateId?: string | null; taxRate?: number | null } | null,
    ) => {
      if (!source) return false;
      const id =
        typeof source.taxRateId === "string" ? source.taxRateId.trim() : "";
      if (id.length) return true;
      const numericRate = normalizeNumber(source.taxRate, Number.NaN);
      return Number.isFinite(numericRate);
    },
    [],
  );

  const resetForm = React.useCallback(
    (next?: Partial<LineFormState>) => {
      const base = { ...defaultForm(currencyCode), ...next };
      const defaultRate = defaultTaxRateRef.current;
      if (!base.taxRateId && defaultRate) {
        base.taxRateId = defaultRate.id;
        base.taxRate = Number.isFinite(defaultRate.rate ?? null)
          ? (defaultRate.rate as number)
          : base.taxRate;
      }
      setInitialValues(base);
      setLineMode(base.lineMode);
      setProductOption(null);
      setVariantOption(null);
      setPriceOptions([]);
      setUnitOptions([]);
      setEditingId(null);
      setFormResetKey((prev) => prev + 1);
    },
    [currencyCode],
  );

  const closeDialog = React.useCallback(() => {
    onOpenChange(false);
    resetForm();
  }, [onOpenChange, resetForm]);

  const loadTaxRates = React.useCallback(async () => {
    try {
      const response = await apiCall<{
        items?: Array<Record<string, unknown>>;
      }>("/api/sales/tax-rates?pageSize=100", undefined, {
        fallback: { items: [] },
      });
      const items = Array.isArray(response.result?.items)
        ? response.result.items
        : [];
      const parsed = items
        .map<TaxRateOption | null>((item) => {
          const id = typeof item.id === "string" ? item.id : null;
          const name =
            typeof item.name === "string" && item.name.trim().length
              ? item.name.trim()
              : typeof item.code === "string"
                ? item.code
                : null;
          if (!id || !name) return null;
          const rate = normalizeNumber((item as ApiTaxRateItem).rate);
          const code =
            typeof (item as ApiTaxRateItem).code === "string" &&
            (item as ApiTaxRateItem).code?.trim().length
              ? (item as ApiTaxRateItem).code?.trim() ?? null
              : null;
          const isDefault = Boolean(
            (item as ApiTaxRateItem).isDefault ?? (item as ApiTaxRateItem).is_default,
          );
          return {
            id,
            name,
            code,
            rate: Number.isFinite(rate) ? rate : null,
            isDefault,
          };
        })
        .filter((entry): entry is TaxRateOption => Boolean(entry));
      taxRatesRef.current = parsed;
      defaultTaxRateRef.current = parsed.find((rate) => rate.isDefault) ?? null;
      setTaxRates(parsed);
      return parsed;
    } catch (err) {
      console.error("sales.tax-rates.fetch", err);
      taxRatesRef.current = [];
      defaultTaxRateRef.current = null;
      setTaxRates([]);
      return [];
    }
  }, []);

  const loadProductOptions = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      const params = new URLSearchParams({ pageSize: "8" });
      if (query && query.trim().length) params.set("search", query.trim());
      const response = await apiCall<{
        items?: Array<Record<string, unknown>>;
      }>(`/api/catalog/products?${params.toString()}`, undefined, {
        fallback: { items: [] },
      });
      const items = Array.isArray(response.result?.items)
        ? (response.result?.items ?? [])
        : [];
      const needle = query?.trim().toLowerCase() ?? "";
      return items
        .map((item) => {
          const id = typeof item.id === "string" ? item.id : null;
          if (!id) return null;
          const productItem = item as ApiProductItem;
          const title =
            typeof item.title === "string"
              ? item.title
              : typeof productItem.name === "string"
                ? productItem.name
                : id;
          const sku =
            typeof productItem.sku === "string" ? productItem.sku : null;
          const thumbnail =
            typeof productItem.default_media_url === "string"
              ? productItem.default_media_url
              : typeof productItem.defaultMediaUrl === "string"
                ? productItem.defaultMediaUrl
                : null;
          const pricing =
            typeof productItem.pricing === "object" && productItem.pricing
              ? productItem.pricing
              : null;
          const metadata =
            typeof productItem.metadata === "object" && productItem.metadata
              ? productItem.metadata
              : null;
          const pricingMeta = pricing as ApiPricingMetadata | null;
          const metaMeta = metadata as ApiPricingMetadata | null;
          const pricingTaxRateId =
            typeof pricingMeta?.tax_rate_id === "string" &&
            pricingMeta.tax_rate_id.trim().length
              ? pricingMeta.tax_rate_id.trim()
              : typeof pricingMeta?.taxRateId === "string" &&
                  pricingMeta.taxRateId.trim().length
                ? pricingMeta.taxRateId.trim()
                : null;
          const metaTaxRateId =
            typeof metaMeta?.taxRateId === "string" &&
            metaMeta.taxRateId.trim().length
              ? metaMeta.taxRateId.trim()
              : typeof metaMeta?.tax_rate_id === "string" &&
                  metaMeta.tax_rate_id.trim().length
                ? metaMeta.tax_rate_id.trim()
                : null;
          const taxRateValue = normalizeNumber(
            pricingMeta?.tax_rate ??
              pricingMeta?.taxRate ??
              productItem.tax_rate ??
              productItem.taxRate,
            Number.NaN,
          );
          const uomFields = getUomProductFields(item);
          const defaultUnit = uomFields.defaultUnit;
          const defaultSalesUnit = uomFields.defaultSalesUnit;
          const defaultSalesUnitQuantity = uomFields.defaultSalesUnitQuantity;
          const matches =
            !needle ||
            title.toLowerCase().includes(needle) ||
            (sku ? sku.toLowerCase().includes(needle) : false);
          if (!matches) return null;
          return {
            id,
            title,
            subtitle: sku ?? undefined,
            icon: thumbnail ? (
              <img
                src={thumbnail}
                alt={title}
                className="h-8 w-8 rounded object-cover"
              />
            ) : (
              buildPlaceholder(title)
            ),
            option: {
              id,
              title,
              sku,
              thumbnailUrl: thumbnail,
              taxRateId: pricingTaxRateId ?? metaTaxRateId ?? null,
              taxRate: Number.isFinite(taxRateValue) ? taxRateValue : null,
              defaultUnit,
              defaultSalesUnit,
              defaultSalesUnitQuantity: Number.isFinite(
                defaultSalesUnitQuantity,
              )
                ? defaultSalesUnitQuantity
                : null,
            } satisfies ProductOption,
          } as LookupSelectItem & { option: ProductOption };
        })
        .filter(
          (entry): entry is LookupSelectItem & { option: ProductOption } =>
            Boolean(entry),
        )
        .map((entry) => {
          productOptionsRef.current.set(entry.option.id, entry.option);
          return entry;
        });
    },
    [],
  );

  const loadVariantOptions = React.useCallback(
    async (
      productId: string,
      fallbackThumbnail?: string | null,
    ): Promise<LookupSelectItem[]> => {
      if (!productId) return [];
      const response = await apiCall<{
        items?: Array<Record<string, unknown>>;
      }>(
        `/api/catalog/variants?productId=${encodeURIComponent(productId)}&pageSize=50`,
        undefined,
        { fallback: { items: [] } },
      );
      const items = Array.isArray(response.result?.items)
        ? response.result.items
        : [];
      return items
        .map((item) => {
          const id = typeof item.id === "string" ? item.id : null;
          if (!id) return null;
          const title = typeof item.name === "string" ? item.name : id;
          const variantItem = item as ApiVariantItem;
          const sku =
            typeof variantItem.sku === "string" ? variantItem.sku : null;
          const metadata =
            typeof variantItem.metadata === "object" && variantItem.metadata
              ? variantItem.metadata
              : null;
          const variantMeta = metadata as ApiPricingMetadata | null;
          const variantTaxRateId =
            typeof variantMeta?.taxRateId === "string" &&
            variantMeta.taxRateId.trim().length
              ? variantMeta.taxRateId.trim()
              : typeof variantMeta?.tax_rate_id === "string" &&
                  variantMeta.tax_rate_id.trim().length
                ? variantMeta.tax_rate_id.trim()
                : null;
          const variantTaxRate = normalizeNumber(
            variantItem.tax_rate ??
              variantItem.taxRate ??
              variantMeta?.tax_rate ??
              variantMeta?.taxRate,
            Number.NaN,
          );
          const thumbnail =
            typeof variantItem.default_media_url === "string"
              ? variantItem.default_media_url
              : typeof variantItem.thumbnailUrl === "string"
                ? variantItem.thumbnailUrl
                : (fallbackThumbnail ?? null);
          return {
            id,
            title,
            subtitle: sku ?? undefined,
            icon: thumbnail ? (
              <img
                src={thumbnail}
                alt={title}
                className="h-8 w-8 rounded object-cover"
              />
            ) : (
              buildPlaceholder(title)
            ),
            option: {
              id,
              title,
              sku,
              thumbnailUrl: thumbnail,
              taxRateId: variantTaxRateId,
              taxRate: Number.isFinite(variantTaxRate) ? variantTaxRate : null,
            } satisfies VariantOption,
          } as LookupSelectItem & { option: VariantOption };
        })
        .filter(
          (entry): entry is LookupSelectItem & { option: VariantOption } =>
            Boolean(entry),
        )
        .map((entry) => {
          variantOptionsRef.current.set(entry.option.id, entry.option);
          return entry;
        });
    },
    [],
  );

  const loadProductUnits = React.useCallback(
    async (
      productId: string | null,
      option: ProductOption | null,
    ): Promise<UnitOption[]> => {
      if (!productId) {
        setUnitOptions([]);
        return [];
      }
      const map = new Map<string, UnitOption>();
      let baseUnit = normalizeUnitCode(option?.defaultUnit);
      let defaultSalesUnit = normalizeUnitCode(option?.defaultSalesUnit);
      if (!baseUnit || !defaultSalesUnit) {
        try {
          const response = await apiCall<{
            items?: Array<Record<string, unknown>>;
          }>(
            `/api/catalog/products?id=${encodeURIComponent(productId)}&pageSize=1`,
            undefined,
            { fallback: { items: [] } },
          );
          const records = Array.isArray(response.result?.items)
            ? response.result.items
            : [];
          const matched =
            records.find((entry) => entry.id === productId) ??
            records[0] ??
            null;
          if (matched) {
            const matchedUom = getUomProductFields(matched);
            baseUnit = baseUnit ?? matchedUom.defaultUnit;
            defaultSalesUnit = defaultSalesUnit ?? matchedUom.defaultSalesUnit;
          }
        } catch (err) {
          console.error("sales.document.items.loadProductUnits.hydration", err);
        }
      }
      if (baseUnit) {
        map.set(baseUnit, { code: baseUnit, toBaseFactor: 1, isBase: true });
      }
      try {
        const response = await apiCall<{
          items?: Array<Record<string, unknown>>;
        }>(
          `/api/catalog/product-unit-conversions?productId=${encodeURIComponent(productId)}&pageSize=100`,
          undefined,
          { fallback: { items: [] } },
        );
        const rows = Array.isArray(response.result?.items)
          ? response.result.items
          : [];
        for (const row of rows) {
          const conv = getUomConversionFields(row);
          if (!conv.unitCode) continue;
          if (!conv.isActive) continue;
          map.set(conv.unitCode, {
            code: conv.unitCode,
            toBaseFactor:
              Number.isFinite(conv.toBaseFactor) && conv.toBaseFactor > 0
                ? conv.toBaseFactor
                : null,
            isBase: baseUnit ? conv.unitCode === baseUnit : false,
          });
        }
      } catch (err) {
        console.error("sales.document.items.loadUnits", err);
      }
      if (defaultSalesUnit && !map.has(defaultSalesUnit)) {
        map.set(defaultSalesUnit, {
          code: defaultSalesUnit,
          toBaseFactor: baseUnit && defaultSalesUnit === baseUnit ? 1 : null,
          isBase: baseUnit ? defaultSalesUnit === baseUnit : false,
        });
      }
      const nextOptions = Array.from(map.values()).sort((left, right) =>
        left.code.localeCompare(right.code),
      );
      setUnitOptions(nextOptions);
      return nextOptions;
    },
    [],
  );

  const loadPrices = React.useCallback(
    async (
      productId: string | null,
      variantId: string | null,
      quantity?: string | number | null,
      quantityUnit?: string | null,
    ) => {
      if (!productId) {
        setPriceOptions([]);
        return [];
      }
      setPriceLoading(true);
      try {
        const params = new URLSearchParams({ productId, pageSize: "20" });
        if (variantId) params.set("variantId", variantId);
        const quantityValue = normalizeNumber(quantity, Number.NaN);
        if (Number.isFinite(quantityValue) && quantityValue > 0) {
          params.set("quantity", String(quantityValue));
        }
        const quantityUnitCode = normalizeUnitCode(quantityUnit);
        if (quantityUnitCode) {
          params.set("quantityUnit", quantityUnitCode);
        }
        const response = await apiCall<{
          items?: Array<Record<string, unknown>>;
        }>(`/api/catalog/prices?${params.toString()}`, undefined, {
          fallback: { items: [] },
        });
        const items = Array.isArray(response.result?.items)
          ? response.result.items
          : [];
        const mapped: PriceOption[] = items
          .map((item) => {
            const id = typeof item.id === "string" ? item.id : null;
            if (!id) return null;
            const amountNetRaw = normalizeNumber(
              (item as ApiPriceItem).unit_price_net,
              Number.NaN,
            );
            const amountGrossRaw = normalizeNumber(
              (item as ApiPriceItem).unit_price_gross,
              Number.NaN,
            );
            const amountNet = Number.isFinite(amountNetRaw)
              ? amountNetRaw
              : null;
            const amountGross = Number.isFinite(amountGrossRaw)
              ? amountGrossRaw
              : null;
            const currency =
              typeof (item as ApiPriceItem).currency_code === "string"
                ? (item as ApiPriceItem).currency_code
                : typeof (item as ApiPriceItem).currencyCode === "string"
                  ? (item as ApiPriceItem).currencyCode
                  : null;
            const displayMode =
              (item as ApiPriceItem).display_mode === "including-tax" ||
              (item as ApiPriceItem).display_mode === "excluding-tax"
                ? (item as ApiPriceItem).display_mode
                : (item as ApiPriceItem).displayMode === "including-tax" ||
                    (item as ApiPriceItem).displayMode === "excluding-tax"
                  ? (item as ApiPriceItem).displayMode
                  : null;
            const taxRateRaw = normalizeNumber(
              (item as ApiPriceItem).tax_rate,
              Number.NaN,
            );
            const taxRate = Number.isFinite(taxRateRaw) ? taxRateRaw : null;
            const priceKindId =
              typeof (item as ApiPriceItem).price_kind_id === "string"
                ? (item as ApiPriceItem).price_kind_id
                : typeof (item as ApiPriceItem).priceKindId === "string"
                  ? (item as ApiPriceItem).priceKindId
                  : null;
            const priceKindTitle =
              typeof (item as ApiPriceItem).price_kind_title === "string"
                ? (item as ApiPriceItem).price_kind_title
                : typeof (item as ApiPriceItem).priceKindTitle === "string"
                  ? (item as ApiPriceItem).priceKindTitle
                  : typeof (item as ApiPriceItem).price_kind === "object" &&
                      item &&
                      typeof (item as ApiPriceItem).price_kind?.title === "string"
                    ? (item as ApiPriceItem).price_kind!.title
                    : typeof (item as ApiPriceItem).price_kind === "object" &&
                        item &&
                        typeof (item as ApiPriceItem).price_kind?.name === "string"
                      ? (item as ApiPriceItem).price_kind!.name
                      : null;
            const priceKindCode =
              typeof (item as ApiPriceItem).price_kind_code === "string"
                ? (item as ApiPriceItem).price_kind_code
                : typeof (item as ApiPriceItem).priceKindCode === "string"
                  ? (item as ApiPriceItem).priceKindCode
                  : typeof (item as ApiPriceItem).price_kind === "object" &&
                      item &&
                      typeof (item as ApiPriceItem).price_kind?.code === "string"
                    ? (item as ApiPriceItem).price_kind!.code
                    : null;
            const resolvedPriceKindTitle =
              priceKindTitle ??
              priceKindCode ??
              (typeof (item as ApiPriceItem).kind === "string"
                ? (item as ApiPriceItem).kind
                : null);
            const labelParts = [
              displayMode === "including-tax" &&
              amountGross !== null &&
              currency
                ? formatMoney(amountGross, currency)
                : null,
              displayMode === "excluding-tax" && amountNet !== null && currency
                ? formatMoney(amountNet, currency)
                : null,
              displayMode
                ? displayMode === "including-tax"
                  ? t("sales.documents.items.priceGross", "Gross")
                  : t("sales.documents.items.priceNet", "Net")
                : null,
            ].filter(Boolean);
            const { reason, tags } = buildPriceScopeReason(
              item,
              (key, fallback) => t(key, fallback),
            );
            const label =
              labelParts.length > 0
                ? labelParts.join(" • ")
                : amountGross !== null && currency
                  ? formatMoney(amountGross, currency)
                  : amountNet !== null && currency
                    ? formatMoney(amountNet, currency)
                    : id;
            return {
              id,
              amountNet: amountNet ?? null,
              amountGross: amountGross ?? null,
              currencyCode: currency,
              displayMode: displayMode as PriceOption["displayMode"],
              taxRate: Number.isFinite(taxRate) ? taxRate : null,
              label,
              priceKindId,
              priceKindTitle: resolvedPriceKindTitle ?? null,
              priceKindCode: priceKindCode ?? null,
              scopeReason: reason,
              scopeTags: tags,
            } as PriceOption;
          })
          .filter((entry): entry is PriceOption => Boolean(entry));
        setPriceOptions(mapped);
        return mapped;
      } catch (err) {
        console.error("sales.document.items.loadPrices", err);
        return [];
      } finally {
        setPriceLoading(false);
      }
    },
    [t],
  );

  const selectPriceAfterRefresh = React.useCallback(
    (
      prices: PriceOption[],
      currentPriceId: string | null,
      currentPriceKindId: string | null,
    ): PriceOption | null => {
      if (!prices.length) return null;
      if (currentPriceId) {
        const sameId = prices.find((entry) => entry.id === currentPriceId);
        if (sameId) return sameId;
      }
      if (currentPriceKindId) {
        const sameKind = prices.find(
          (entry) => entry.priceKindId === currentPriceKindId,
        );
        if (sameKind) return sameKind;
      }
      return prices[0] ?? null;
    },
    [],
  );

  const resolveUnitPriceFactor = React.useCallback(
    (quantityUnit: string | null | undefined): number => {
      const normalized = normalizeUnitCode(quantityUnit);
      if (!normalized) return 1;
      const unit = unitOptions.find((entry) => entry.code === normalized) ?? null;
      const factor = normalizeNumber(unit?.toBaseFactor, Number.NaN);
      if (!Number.isFinite(factor) || factor <= 0) return 1;
      return factor;
    },
    [unitOptions],
  );

  const convertUnitPriceForUnitChange = React.useCallback(
    (
      rawUnitPrice: unknown,
      fromUnit: string | null | undefined,
      toUnit: string | null | undefined,
    ): string | null => {
      const amount = normalizeNumber(rawUnitPrice, Number.NaN);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      const fromCode = normalizeUnitCode(fromUnit);
      const toCode = normalizeUnitCode(toUnit);
      if (!fromCode || !toCode || fromCode === toCode) return null;
      const fromFactor = resolveUnitPriceFactor(fromCode);
      const toFactor = resolveUnitPriceFactor(toCode);
      if (
        !Number.isFinite(fromFactor) ||
        !Number.isFinite(toFactor) ||
        fromFactor <= 0 ||
        toFactor <= 0
      ) {
        return null;
      }
      const baseAmount = amount / fromFactor;
      const convertedAmount = baseAmount * toFactor;
      if (!Number.isFinite(convertedAmount) || convertedAmount <= 0) return null;
      return normalizeUnitPriceInputValue(convertedAmount);
    },
    [resolveUnitPriceFactor],
  );

  const applyPriceSelection = React.useCallback(
    (
      selected: PriceOption | null,
      setFormValue: ((id: string, value: unknown) => void) | undefined,
      options?: {
        fallbackTaxSource?: { taxRateId?: string | null; taxRate?: number | null } | null;
        quantityUnit?: string | null;
      },
    ) => {
      if (!setFormValue) return;
      if (selected) {
        const mode =
          selected.displayMode === "excluding-tax" ? "net" : "gross";
        const amountPerBaseUnit =
          mode === "net"
            ? (selected.amountNet ?? selected.amountGross ?? 0)
            : (selected.amountGross ?? selected.amountNet ?? 0);
        const factor = resolveUnitPriceFactor(options?.quantityUnit ?? null);
        const amount = Number.isFinite(amountPerBaseUnit * factor)
          ? amountPerBaseUnit * factor
          : amountPerBaseUnit;
        setFormValue("priceId", selected.id);
        setFormValue("priceMode", mode);
        setFormValue("unitPrice", normalizeUnitPriceInputValue(amount));
        setFormValue("taxRate", selected.taxRate ?? null);
        setFormValue("taxRateId", findTaxRateIdByValue(selected.taxRate));
        setFormValue(
          "currencyCode",
          selected.currencyCode ?? currencyCode ?? null,
        );
        return;
      }
      const fallbackTax = resolveTaxSelection(options?.fallbackTaxSource ?? null);
      setFormValue("taxRate", fallbackTax.taxRate ?? null);
      setFormValue("taxRateId", fallbackTax.taxRateId ?? null);
    },
    [currencyCode, findTaxRateIdByValue, resolveTaxSelection, resolveUnitPriceFactor],
  );

  const loadLineStatuses = React.useCallback(async (): Promise<
    StatusOption[]
  > => {
    setLineStatusLoading(true);
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "100" });
      const response = await apiCall<{
        items?: Array<Record<string, unknown>>;
      }>(`/api/sales/order-line-statuses?${params.toString()}`, undefined, {
        fallback: { items: [] },
      });
      const items = Array.isArray(response.result?.items)
        ? response.result.items
        : [];
      const mapped = items
        .map((entry) => {
          const id = typeof entry.id === "string" ? entry.id : null;
          const value = typeof entry.value === "string" ? entry.value : null;
          if (!id || !value) return null;
          const label =
            typeof entry.label === "string" && entry.label.trim().length
              ? entry.label
              : value;
          const color =
            typeof entry.color === "string" && entry.color.trim().length
              ? entry.color
              : null;
          const icon =
            typeof entry.icon === "string" && entry.icon.trim().length
              ? entry.icon
              : null;
          return { id, value, label, color, icon };
        })
        .filter((entry): entry is StatusOption => Boolean(entry));
      setLineStatuses(mapped);
      return mapped;
    } catch (err) {
      console.error("sales.lines.statuses.load", err);
      setLineStatuses([]);
      return [];
    } finally {
      setLineStatusLoading(false);
    }
  }, []);

  const fetchLineStatusItems = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      const options =
        lineStatuses.length && !query ? lineStatuses : await loadLineStatuses();
      const term = query?.trim().toLowerCase() ?? "";
      const currentMap = options.reduce<
        Record<
          string,
          {
            value: string;
            label: string;
            color?: string | null;
            icon?: string | null;
          }
        >
      >((acc, entry) => {
        acc[entry.value] = {
          value: entry.value,
          label: entry.label,
          color: entry.color,
          icon: entry.icon ?? null,
        };
        return acc;
      }, {});
      return options
        .filter(
          (option) =>
            !term.length ||
            option.label.toLowerCase().includes(term) ||
            option.value.toLowerCase().includes(term),
        )
        .map<LookupSelectItem>((option) => ({
          id: option.id,
          title: option.label,
          subtitle: option.label !== option.value ? option.value : undefined,
          icon:
            renderDictionaryIcon(option.icon, "h-4 w-4") ??
            renderDictionaryColor(option.color, "h-4 w-4 rounded-full"),
        }));
    },
    [lineStatuses, loadLineStatuses],
  );

  React.useEffect(() => {
    if (!open) return;
    loadTaxRates().catch(() => {});
    loadLineStatuses().catch(() => {});
  }, [loadLineStatuses, loadTaxRates, open]);

  const handleFormSubmit = React.useCallback(
    async (values: LineFormState & Record<string, unknown>) => {
      // Resolve required scope and ids
      const resolvedDocumentId =
        typeof documentId === "string" && documentId.trim().length
          ? documentId
          : null;
      const resolvedOrg = resolvedOrganizationId;
      const resolvedTenant = resolvedTenantId;

      if (!resolvedOrg || !resolvedTenant || !resolvedDocumentId) {
        throw createCrudFormError(
          t(
            "sales.documents.items.errorScope",
            "Organization and tenant are required.",
          ),
        );
      }
      const lineMode = values.lineMode === "custom" ? "custom" : "catalog";
      const isCustomLine = lineMode === "custom";

      if (!isCustomLine && !values.productId) {
        throw createCrudFormError(
          t(
            "sales.documents.items.errorProductRequired",
            "Select a product to continue.",
          ),
          {
            productId: t(
              "sales.documents.items.errorProductRequired",
              "Select a product to continue.",
            ),
          },
        );
      }
      if (!isCustomLine && !values.variantId) {
        throw createCrudFormError(
          t(
            "sales.documents.items.errorVariantRequired",
            "Select a variant to continue.",
          ),
          {
            variantId: t(
              "sales.documents.items.errorVariantRequired",
              "Select a variant to continue.",
            ),
          },
        );
      }

      const qtyNumber = Number(values.quantity ?? 0);
      if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) {
        throw createCrudFormError(
          t(
            "sales.documents.items.errorQuantity",
            "Quantity must be greater than 0.",
          ),
          {
            quantity: t(
              "sales.documents.items.errorQuantity",
              "Quantity must be greater than 0.",
            ),
          },
        );
      }
      const resolvedQuantityUnit = (() => {
        const entered = normalizeUnitCode(values.quantityUnit);
        if (isCustomLine) return entered;
        return (
          entered ??
          normalizeUnitCode(productOption?.defaultSalesUnit) ??
          normalizeUnitCode(productOption?.defaultUnit)
        );
      })();

      const unitPriceNumber = Number(values.unitPrice ?? 0);
      if (!Number.isFinite(unitPriceNumber) || unitPriceNumber <= 0) {
        throw createCrudFormError(
          t(
            "sales.documents.items.errorUnitPrice",
            "Unit price must be greater than 0.",
          ),
          {
            unitPrice: t(
              "sales.documents.items.errorUnitPrice",
              "Unit price must be greater than 0.",
            ),
          },
        );
      }

      const selectedPrice =
        !isCustomLine && values.priceId
          ? (priceOptions.find((price) => price.id === values.priceId) ?? null)
          : null;
      const resolvedCurrency =
        (values.currencyCode as string | null | undefined) ??
        selectedPrice?.currencyCode ??
        currencyCode ??
        null;
      if (!resolvedCurrency) {
        throw createCrudFormError(
          t("sales.documents.items.errorCurrency", "Currency is required."),
          {
            priceId: t(
              "sales.documents.items.errorCurrency",
              "Currency is required.",
            ),
          },
        );
      }

      const resolvedNameRaw = (values.name ?? "").toString().trim();
      const resolvedName = isCustomLine
        ? resolvedNameRaw
        : resolvedNameRaw ||
          variantOption?.title ||
          productOption?.title ||
          undefined;
      if (isCustomLine && !resolvedName) {
        throw createCrudFormError(
          t(
            "sales.documents.items.errorNameRequired",
            "Name is required for custom lines.",
          ),
          {
            name: t(
              "sales.documents.items.errorNameRequired",
              "Name is required for custom lines.",
            ),
          },
        );
      }
      const resolvedPriceMode = values.priceMode === "net" ? "net" : "gross";
      const catalogSnapshot =
        !isCustomLine &&
        typeof values.catalogSnapshot === "object" &&
        values.catalogSnapshot
          ? values.catalogSnapshot
          : null;
      const selectedTaxRateId =
        typeof values.taxRateId === "string" && values.taxRateId.trim().length
          ? values.taxRateId
          : null;
      const resolvedTaxRate = Number.isFinite(values.taxRate)
        ? (values.taxRate as number)
        : normalizeNumber(values.taxRate);
      const normalizedTaxRate = Number.isFinite(resolvedTaxRate)
        ? resolvedTaxRate
        : 0;
      const unitPriceNetValue =
        resolvedPriceMode === "net"
          ? unitPriceNumber
          : unitPriceNumber / (1 + normalizedTaxRate / 100);
      const unitPriceGrossValue =
        resolvedPriceMode === "gross"
          ? unitPriceNumber
          : unitPriceNumber * (1 + normalizedTaxRate / 100);
      const safeUnitPriceNet = Number.isFinite(unitPriceNetValue)
        ? unitPriceNetValue
        : unitPriceNumber;
      const safeUnitPriceGross = Number.isFinite(unitPriceGrossValue)
        ? unitPriceGrossValue
        : unitPriceNumber;
      const totalNetAmount = safeUnitPriceNet * qtyNumber;
      const totalGrossAmount = safeUnitPriceGross * qtyNumber;

      const metadata = {
        ...(catalogSnapshot ?? {}),
        ...(!isCustomLine && values.priceId ? { priceId: values.priceId } : {}),
        priceMode: resolvedPriceMode,
        ...(selectedTaxRateId ? { taxRateId: selectedTaxRateId } : {}),
        ...(!isCustomLine && productOption
          ? {
              productTitle: productOption.title,
              productSku: productOption.sku ?? null,
              productThumbnail: productOption.thumbnailUrl ?? null,
            }
          : {}),
        ...(!isCustomLine && variantOption
          ? {
              variantTitle: variantOption.title,
              variantSku: variantOption.sku ?? null,
              variantThumbnail:
                variantOption.thumbnailUrl ??
                productOption?.thumbnailUrl ??
                null,
            }
          : {}),
        ...(isCustomLine ? { customLine: true } : {}),
        lineMode,
        ...(resolvedQuantityUnit ? { quantityUnit: resolvedQuantityUnit } : {}),
      };

      const payload: Record<string, unknown> = {
        [documentKey]: String(resolvedDocumentId),
        organizationId: String(resolvedOrg),
        tenantId: String(resolvedTenant),
        productId: isCustomLine
          ? undefined
          : values.productId
            ? String(values.productId)
            : undefined,
        productVariantId: isCustomLine
          ? undefined
          : values.variantId
            ? String(values.variantId)
            : undefined,
        quantity: qtyNumber,
        quantityUnit: resolvedQuantityUnit ?? undefined,
        currencyCode: String(resolvedCurrency),
        priceId:
          !isCustomLine && values.priceId ? String(values.priceId) : undefined,
        priceMode: resolvedPriceMode,
        taxRate: Number.isFinite(resolvedTaxRate) ? resolvedTaxRate : undefined,
        unitPriceNet: safeUnitPriceNet,
        unitPriceGross: safeUnitPriceGross,
        totalNetAmount,
        totalGrossAmount,
        ...(catalogSnapshot ? { catalogSnapshot } : {}),
        metadata,
        customFieldSetId: values.customFieldSetId ?? undefined,
        ...(typeof values.statusEntryId === "string" &&
        values.statusEntryId.trim().length
          ? { statusEntryId: values.statusEntryId.trim() }
          : {}),
      };

      const customFields = collectCustomFieldValues(values, {
        transform: (value) => normalizeCustomFieldSubmitValue(value),
      });
      if (Object.keys(customFields).length) {
        payload.customFields = normalizeCustomFieldValues(customFields);
      }
      if (resolvedName) payload.name = resolvedName;

      try {
        const action = editingId ? updateCrud : createCrud;
        const result = await action(
          resourcePath,
          editingId ? { id: editingId, ...payload } : payload,
          {
            errorMessage: t(
              "sales.documents.items.errorSave",
              "Failed to save line.",
            ),
          },
        );
        if (result.ok) {
          if (onSaved) await onSaved();
          closeDialog();
        }
      } catch (err) {
        throw err;
      }
    },
    [
      currencyCode,
      documentId,
      documentKey,
      editingId,
      priceOptions,
      productOption,
      resourcePath,
      t,
      variantOption,
      onSaved,
      closeDialog,
      resolvedOrganizationId,
      resolvedTenantId,
    ],
  );

  const fields = React.useMemo<CrudField[]>(() => {
    const isCustomLine = lineMode === "custom";
    return [
      {
        id: "lineMode",
        label: t("sales.documents.items.lineMode.label", "Line type"),
        type: "custom",
        layout: "full",
        component: ({ value, setValue, setFormValue }: FieldRenderProps) => {
          const mode = value === "custom" ? "custom" : "catalog";
          const switchMode = (next: "catalog" | "custom") => {
            if (next === mode) return;
            setValue(next);
            setLineMode(next);
            if (next === "custom") {
              setProductOption(null);
              setVariantOption(null);
              setPriceOptions([]);
              setUnitOptions([]);
              setFormValue?.("productId", null);
              setFormValue?.("variantId", null);
              setFormValue?.("priceId", null);
              setFormValue?.("catalogSnapshot", null);
              setFormValue?.("quantityUnit", null);
            } else {
              setFormValue?.("unitPrice", "");
              setFormValue?.("priceMode", "gross");
            }
          };
          return (
            <div className="flex flex-col gap-2">
              <div className="inline-flex w-fit gap-1 rounded-md border bg-muted/50 p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "catalog" ? "default" : "ghost"}
                  onClick={() => switchMode("catalog")}
                >
                  {t("sales.documents.items.lineMode.catalog", "Catalog item")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "custom" ? "default" : "ghost"}
                  onClick={() => switchMode("custom")}
                >
                  {t("sales.documents.items.lineMode.custom", "Custom line")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t(
                  "sales.documents.items.lineMode.helper",
                  "Use catalog products or create a freeform line with your own price.",
                )}
              </p>
            </div>
          );
        },
      } satisfies CrudField,
      ...(!isCustomLine
        ? [
            {
              id: "productId",
              label: t("sales.documents.items.product", "Product"),
              type: "custom",
              required: true,
              layout: "half",
              component: ({
                value,
                setValue,
                setFormValue,
                values,
              }: FieldRenderProps) => (
                <LookupSelect
                  value={typeof value === "string" ? value : null}
                  onChange={(next) => {
                    const selectedOption = next
                      ? (productOptionsRef.current.get(next) ?? null)
                      : null;
                    setProductOption(selectedOption);
                    setVariantOption(null);
                    setPriceOptions([]);
                    setUnitOptions([]);
                    setValue(next ?? null);
                    setFormValue?.("variantId", null);
                    setFormValue?.("priceId", null);
                    setFormValue?.("unitPrice", "");
                    setFormValue?.("priceMode", "gross");
                    const defaultQuantityUnit =
                      selectedOption?.defaultSalesUnit ??
                      selectedOption?.defaultUnit ??
                      null;
                    setFormValue?.("quantityUnit", defaultQuantityUnit);
                    if (
                      typeof selectedOption?.defaultSalesUnitQuantity ===
                        "number" &&
                      Number.isFinite(
                        selectedOption.defaultSalesUnitQuantity,
                      ) &&
                      selectedOption.defaultSalesUnitQuantity > 0
                    ) {
                      setFormValue?.(
                        "quantity",
                        String(selectedOption.defaultSalesUnitQuantity),
                      );
                    }
                    const taxSelection = selectedOption
                      ? resolveTaxSelection(selectedOption)
                      : { taxRate: null, taxRateId: null };
                    setFormValue?.("taxRate", taxSelection.taxRate ?? null);
                    setFormValue?.("taxRateId", taxSelection.taxRateId ?? null);
                    const existingName =
                      typeof values?.name === "string" ? values.name : "";
                    if (!existingName.trim() && selectedOption?.title) {
                      setFormValue?.("name", selectedOption.title);
                    }
                    setFormValue?.(
                      "catalogSnapshot",
                      next
                        ? {
                            product: {
                              id: next,
                              title: selectedOption?.title ?? null,
                              sku: selectedOption?.sku ?? null,
                              thumbnailUrl:
                                selectedOption?.thumbnailUrl ?? null,
                              defaultUnit: selectedOption?.defaultUnit ?? null,
                              defaultSalesUnit:
                                selectedOption?.defaultSalesUnit ?? null,
                            },
                          }
                        : null,
                    );
                    if (next) {
                      void loadProductUnits(next, selectedOption);
                      void loadPrices(
                        next,
                        null,
                        typeof values?.quantity === "string"
                          ? values.quantity
                          : 1,
                        defaultQuantityUnit,
                      );
                    }
                  }}
                  fetchItems={loadProductOptions}
                  options={
                    productOption
                      ? [
                          {
                            id: productOption.id,
                            title: productOption.title || productOption.id,
                            subtitle: productOption.sku ?? undefined,
                            icon: productOption.thumbnailUrl ? (
                              <img
                                src={productOption.thumbnailUrl}
                                alt={productOption.title ?? productOption.id}
                                className="h-8 w-8 rounded object-cover"
                              />
                            ) : (
                              buildPlaceholder(
                                productOption.title || productOption.id,
                              )
                            ),
                          },
                        ]
                      : undefined
                  }
                  minQuery={1}
                  searchPlaceholder={t(
                    "sales.documents.items.productSearch",
                    "Search product",
                  )}
                  selectLabel={t("ui.lookupSelect.select", "Select")}
                  selectedLabel={t("ui.lookupSelect.selected", "Selected")}
                  clearLabel={t(
                    "ui.lookupSelect.clearSelection",
                    "Clear selection",
                  )}
                  emptyLabel={t("ui.lookupSelect.noResults", "No results")}
                  loadingLabel={t("ui.lookupSelect.searching", "Searching…")}
                  startTypingLabel={t(
                    "ui.lookupSelect.startTyping",
                    "Start typing to search.",
                  )}
                  selectedHintLabel={(id) =>
                    t(
                      "sales.documents.items.selectedProduct",
                      "Selected {{id}}",
                      {
                        id: productOption?.title ?? id,
                      },
                    )
                  }
                />
              ),
            } satisfies CrudField,
            {
              id: "variantId",
              label: t("sales.documents.items.variant", "Variant"),
              type: "custom",
              required: true,
              layout: "half",
              component: ({
                value,
                setValue,
                setFormValue,
                values,
              }: FieldRenderProps) => {
                const productId =
                  typeof values?.productId === "string"
                    ? values.productId
                    : null;
                return (
                  <LookupSelect
                    key={productId ?? "no-product"}
                    value={typeof value === "string" ? value : null}
                    onChange={(next) => {
                      const selectedOption = next
                        ? (variantOptionsRef.current.get(next) ?? null)
                        : null;
                      setVariantOption(selectedOption);
                      setValue(next ?? null);
                      const existingName =
                        typeof values?.name === "string" ? values.name : "";
                      if (!existingName.trim()) {
                        setFormValue?.(
                          "name",
                          selectedOption?.title ??
                            productOption?.title ??
                            existingName,
                        );
                      }
                      const taxSource = hasTaxMetadata(selectedOption)
                        ? selectedOption
                        : hasTaxMetadata(productOption)
                          ? productOption
                          : null;
                      if (taxSource) {
                        const taxSelection = resolveTaxSelection(taxSource);
                        setFormValue?.("taxRate", taxSelection.taxRate ?? null);
                        setFormValue?.(
                          "taxRateId",
                          taxSelection.taxRateId ?? null,
                        );
                      }
                      const prevSnapshot =
                        typeof values?.catalogSnapshot === "object" &&
                        values.catalogSnapshot
                          ? (values.catalogSnapshot as Record<string, unknown>)
                          : null;
                      if (next) {
                        setFormValue?.("catalogSnapshot", {
                          ...(prevSnapshot ?? {}),
                          variant: {
                            id: next,
                            title: selectedOption?.title ?? null,
                            sku: selectedOption?.sku ?? null,
                            thumbnailUrl: selectedOption?.thumbnailUrl ?? null,
                          },
                        });
                      } else if (prevSnapshot) {
                        const snapshot = { ...prevSnapshot };
                        if ("variant" in snapshot)
                          delete (snapshot as CatalogSnapshotRecord).variant;
                        setFormValue?.(
                          "catalogSnapshot",
                          Object.keys(snapshot).length ? snapshot : null,
                        );
                      } else {
                        setFormValue?.("catalogSnapshot", null);
                      }
                      if (productId) {
                        const currentQuantity =
                          typeof values?.quantity === "string"
                            ? values.quantity
                            : 1;
                        const currentQuantityUnit =
                          typeof values?.quantityUnit === "string"
                            ? values.quantityUnit
                            : null;
                        void loadPrices(
                          productId,
                          next,
                          currentQuantity,
                          currentQuantityUnit,
                        );
                      }
                    }}
                    fetchItems={async (query) => {
                      if (!productId) return [];
                      const productThumb = productId
                        ? productOptionsRef.current.get(productId)?.thumbnailUrl
                        : null;
                      const options = await loadVariantOptions(
                        productId,
                        productThumb,
                      );
                      const needle = query?.trim().toLowerCase() ?? "";
                      return needle.length
                        ? options.filter((option) =>
                            option.title.toLowerCase().includes(needle),
                          )
                        : options;
                    }}
                    searchPlaceholder={t(
                      "sales.documents.items.variantSearch",
                      "Search variant",
                    )}
                    selectLabel={t("ui.lookupSelect.select", "Select")}
                    selectedLabel={t("ui.lookupSelect.selected", "Selected")}
                    clearLabel={t(
                      "ui.lookupSelect.clearSelection",
                      "Clear selection",
                    )}
                    emptyLabel={t("ui.lookupSelect.noResults", "No results")}
                    loadingLabel={t("ui.lookupSelect.searching", "Searching…")}
                    startTypingLabel={t(
                      "ui.lookupSelect.startTyping",
                      "Start typing to search.",
                    )}
                    minQuery={0}
                    options={
                      variantOption
                        ? [
                            {
                              id: variantOption.id,
                              title: variantOption.title || variantOption.id,
                              subtitle: variantOption.sku ?? undefined,
                              icon: variantOption.thumbnailUrl ? (
                                <img
                                  src={variantOption.thumbnailUrl}
                                  alt={variantOption.title ?? variantOption.id}
                                  className="h-8 w-8 rounded object-cover"
                                />
                              ) : (
                                buildPlaceholder(
                                  variantOption.title || variantOption.id,
                                )
                              ),
                            },
                          ]
                        : undefined
                    }
                    selectedHintLabel={(id) =>
                      t(
                        "sales.documents.items.selectedVariant",
                        "Selected {{id}}",
                        {
                          id: variantOption?.title ?? id,
                        },
                      )
                    }
                    disabled={!productId}
                  />
                );
              },
            } satisfies CrudField,
            {
              id: "priceId",
              label: t("sales.documents.items.price", "Price"),
              type: "custom",
              layout: "half",
              component: ({
                value,
                setValue,
                setFormValue,
                values,
              }: FieldRenderProps) => {
                const productId =
                  typeof values?.productId === "string"
                    ? values.productId
                    : null;
                const variantId =
                  typeof values?.variantId === "string"
                    ? values.variantId
                    : null;
                return (
                  <LookupSelect
                    key={
                      productId
                        ? `${productId}-${variantId ?? "no-variant"}`
                        : "price"
                    }
                    value={typeof value === "string" ? value : null}
                    onChange={(next) => {
                      setValue(next ?? null);
                      const selected = next
                        ? (priceOptions.find((entry) => entry.id === next) ??
                          null)
                        : null;
                      applyPriceSelection(
                        selected,
                        setFormValue,
                        {
                          fallbackTaxSource: variantOption ?? productOption ?? null,
                          quantityUnit:
                            typeof values?.quantityUnit === "string"
                              ? values.quantityUnit
                              : null,
                        },
                      );
                    }}
                    fetchItems={async (query) => {
                      const prices = await loadPrices(
                        productId,
                        variantId,
                        typeof values?.quantity === "string"
                          ? values.quantity
                          : 1,
                        typeof values?.quantityUnit === "string"
                          ? values.quantityUnit
                          : null,
                      );
                      const needle = query?.trim().toLowerCase() ?? "";
                      return prices
                        .filter((price) => {
                          if (!needle.length) return true;
                          const haystack = [
                            price.label,
                            price.priceKindTitle,
                            price.priceKindCode,
                            price.currencyCode,
                            ...(price.scopeTags ?? []),
                          ]
                            .filter(Boolean)
                            .join(" ")
                            .toLowerCase();
                          return haystack.includes(needle);
                        })
                        .map<LookupSelectItem>((price) => ({
                          id: price.id,
                          title: price.label,
                          subtitle:
                            price.priceKindTitle ??
                            price.priceKindCode ??
                            undefined,
                          description: price.scopeReason ?? undefined,
                          rightLabel: price.currencyCode ?? undefined,
                          icon: (
                            <DollarSign className="h-5 w-5 text-muted-foreground" />
                          ),
                        }));
                    }}
                    minQuery={0}
                    loading={priceLoading}
                    searchPlaceholder={t(
                      "sales.documents.items.priceSearch",
                      "Select price",
                    )}
                    selectLabel={t("ui.lookupSelect.select", "Select")}
                    selectedLabel={t("ui.lookupSelect.selected", "Selected")}
                    clearLabel={t(
                      "ui.lookupSelect.clearSelection",
                      "Clear selection",
                    )}
                    emptyLabel={t("ui.lookupSelect.noResults", "No results")}
                    loadingLabel={t("ui.lookupSelect.searching", "Searching…")}
                    startTypingLabel={t(
                      "ui.lookupSelect.startTyping",
                      "Start typing to search.",
                    )}
                    disabled={!productId}
                  />
                );
              },
            } satisfies CrudField,
          ]
        : []),
      {
        id: "unitPrice",
        label: t("sales.documents.items.unitPrice", "Unit price"),
        type: "custom",
        layout: "half",
        component: ({
          value,
          setValue,
          setFormValue,
          values,
        }: FieldRenderProps) => {
          const mode = values?.priceMode === "net" ? "net" : "gross";
          const selectedPriceId =
            typeof values?.priceId === "string" ? values.priceId : null;
          const selectedPrice = selectedPriceId
            ? (priceOptions.find((entry) => entry.id === selectedPriceId) ?? null)
            : null;
          const selectedCurrency =
            selectedPrice?.currencyCode ??
            (typeof values?.currencyCode === "string" ? values.currencyCode : null);
          const quantityUnitCode = normalizeUnitCode(values?.quantityUnit);
          const baseUnitCode =
            unitOptions.find((option) => option.isBase)?.code ?? null;
          const selectedUnitOption = quantityUnitCode
            ? (unitOptions.find((option) => option.code === quantityUnitCode) ?? null)
            : null;
          const unitFactor = (() => {
            if (!quantityUnitCode) return null;
            if (baseUnitCode && quantityUnitCode === baseUnitCode) return 1;
            const value = normalizeNumber(selectedUnitOption?.toBaseFactor, Number.NaN);
            return Number.isFinite(value) && value > 0 ? value : null;
          })();
          const selectedBaseAmount = selectedPrice
            ? mode === "net"
              ? (selectedPrice.amountNet ?? selectedPrice.amountGross ?? null)
              : (selectedPrice.amountGross ?? selectedPrice.amountNet ?? null)
            : null;
          const convertedAmount =
            selectedBaseAmount !== null &&
            unitFactor !== null &&
            Number.isFinite(selectedBaseAmount * unitFactor)
              ? selectedBaseAmount * unitFactor
              : null;
          const isCatalogLine = lineMode !== "custom";
          return (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={
                    typeof value === "string"
                      ? value
                      : value == null
                        ? ""
                        : String(value)
                  }
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="0.00"
                />
                <select
                  className="w-32 rounded border px-2 text-sm"
                  value={mode}
                  onChange={(event) => {
                    const nextMode =
                      event.target.value === "net" ? "net" : "gross";
                    setFormValue?.("priceMode", nextMode);
                  }}
                >
                  <option value="gross">
                    {t("sales.documents.items.priceGross", "Gross")}
                  </option>
                  <option value="net">
                    {t("sales.documents.items.priceNet", "Net")}
                  </option>
                </select>
              </div>
              {isCatalogLine && selectedPrice && quantityUnitCode && baseUnitCode ? (
                unitFactor !== null && convertedAmount !== null ? (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "sales.documents.items.priceBasisTemplate",
                      "Catalog price basis: {{baseAmount}} / {{baseUnit}}. Converted for {{unit}}: {{baseAmount}} × {{factor}} = {{convertedAmount}}.",
                      {
                        baseAmount: formatMoney(selectedBaseAmount as number, selectedCurrency),
                        baseUnit: baseUnitCode,
                        unit: quantityUnitCode,
                        factor: unitFactor,
                        convertedAmount: formatMoney(convertedAmount, selectedCurrency),
                      },
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "sales.documents.items.priceBasisMissingConversion",
                      "Catalog price basis is base unit, but conversion for selected unit is missing.",
                    )}
                  </p>
                )
              ) : null}
              {isCatalogLine && !selectedPrice ? (
                <p className="text-xs text-muted-foreground">
                  {t(
                    "sales.documents.items.priceBasisManual",
                    "Manual unit price mode. Price will not auto-convert until you select a catalog price.",
                  )}
                </p>
              ) : null}
            </div>
          );
        },
      } satisfies CrudField,
      {
        id: "taxRateId",
        label: t("sales.documents.items.taxRate", "Tax class"),
        type: "custom",
        layout: "half",
        component: ({
          value,
          setValue,
          setFormValue,
          values,
        }: FieldRenderProps) => {
          const resolvedValue =
            typeof value === "string" && value.trim().length
              ? value
              : findTaxRateIdByValue((values as Record<string, unknown>)?.taxRate as number | null | undefined);
          const handleChange = (
            event: React.ChangeEvent<HTMLSelectElement>,
          ) => {
            const nextId = event.target.value || null;
            const option = nextId ? (taxRateMap.get(nextId) ?? null) : null;
            setValue(nextId);
            const rate = normalizeNumber(option?.rate);
            setFormValue?.("taxRate", Number.isFinite(rate) ? rate : null);
          };
          return (
            <div className="flex items-center gap-2">
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={resolvedValue ?? ""}
                onChange={handleChange}
                disabled={!taxRates.length}
              >
                <option value="">
                  {taxRates.length
                    ? t(
                        "sales.documents.items.taxRate.none",
                        "No tax class selected",
                      )
                    : t(
                        "sales.documents.items.taxRate.empty",
                        "No tax classes available",
                      )}
                </option>
                {taxRates.map((rate) => (
                  <option key={rate.id} value={rate.id}>
                    {rate.name}
                    {rate.code ? ` • ${rate.code.toUpperCase()}` : ""}
                    {Number.isFinite(rate.rate) ? ` • ${rate.rate}%` : ""}
                  </option>
                ))}
              </select>
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
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      } satisfies CrudField,
      {
        id: "quantityUnit",
        label: t("sales.documents.items.quantityUnit", "Unit"),
        type: "custom",
        layout: "half",
        component: ({ value, setValue, setFormValue, values }: FieldRenderProps) => {
          const productId =
            typeof values?.productId === "string" ? values.productId : null;
          const variantId =
            typeof values?.variantId === "string" ? values.variantId : null;
          if (isCustomLine) {
            return (
              <Input
                value={typeof value === "string" ? value : ""}
                onChange={(event) => setValue(event.target.value || null)}
                placeholder={t(
                  "sales.documents.items.quantityUnitPlaceholder",
                  "e.g. pc",
                )}
              />
            );
          }
          return (
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={typeof value === "string" ? value : ""}
              onChange={(event) => {
                const nextValue = event.target.value || null;
                const nextUnitPrice = convertUnitPriceForUnitChange(
                  values?.unitPrice,
                  typeof value === "string" ? value : null,
                  nextValue,
                );
                setValue(nextValue);
                if (nextUnitPrice) {
                  setFormValue?.("unitPrice", nextUnitPrice);
                }
                if (productId) {
                  const selectedPriceId =
                    typeof values?.priceId === "string" ? values.priceId : null;
                  const selectedPriceKindId =
                    selectedPriceId
                      ? (priceOptions.find(
                          (entry) => entry.id === selectedPriceId,
                        )?.priceKindId ?? null)
                      : null;
                  void loadPrices(
                    productId,
                    variantId,
                    typeof values?.quantity === "string" ? values.quantity : 1,
                    nextValue,
                  ).then((prices) => {
                    if (!selectedPriceId) return;
                    const nextSelected = selectPriceAfterRefresh(
                      prices,
                      selectedPriceId,
                      selectedPriceKindId,
                    );
                    if (!nextSelected) {
                      setFormValue?.("priceId", null);
                      return;
                    }
                    applyPriceSelection(
                      nextSelected,
                      setFormValue,
                      {
                        fallbackTaxSource: variantOption ?? productOption ?? null,
                        quantityUnit: nextValue,
                      },
                    );
                  });
                }
              }}
              disabled={!productId}
            >
              <option value="">
                {t("sales.documents.items.quantityUnitSelect", "Select unit")}
              </option>
              {unitOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.isBase
                    ? `${option.code} (${t("sales.documents.items.baseUnitTag", "base")})`
                    : option.code}
                </option>
              ))}
            </select>
          );
        },
      } satisfies CrudField,
      {
        id: "quantity",
        label: t("sales.documents.items.quantity", "Quantity"),
        type: "custom",
        layout: "half",
        component: ({ value, setValue, setFormValue, values }: FieldRenderProps) => (
          <Input
            value={
              typeof value === "string"
                ? value
                : value == null
                  ? ""
                  : String(value)
            }
            onChange={(event) => {
              const nextQuantity = event.target.value;
              setValue(nextQuantity);
              const productId =
                typeof values?.productId === "string" ? values.productId : null;
              const variantId =
                typeof values?.variantId === "string" ? values.variantId : null;
              const quantityUnit =
                typeof values?.quantityUnit === "string"
                  ? values.quantityUnit
                  : null;
              if (productId) {
                const selectedPriceId =
                  typeof values?.priceId === "string" ? values.priceId : null;
                const selectedPriceKindId =
                  selectedPriceId
                    ? (priceOptions.find((entry) => entry.id === selectedPriceId)
                        ?.priceKindId ?? null)
                    : null;
                void loadPrices(
                  productId,
                  variantId,
                  nextQuantity,
                  quantityUnit,
                ).then((prices) => {
                  if (!selectedPriceId) return;
                  const nextSelected = selectPriceAfterRefresh(
                    prices,
                    selectedPriceId,
                    selectedPriceKindId,
                  );
                  if (!nextSelected) {
                    setFormValue?.("priceId", null);
                    return;
                  }
                  applyPriceSelection(
                    nextSelected,
                    setFormValue,
                    {
                      fallbackTaxSource: variantOption ?? productOption ?? null,
                      quantityUnit,
                    },
                  );
                });
              }
            }}
            placeholder="1"
          />
        ),
      } satisfies CrudField,
      {
        id: "uomPreview",
        label: t("sales.documents.items.uomPreview", "Normalized quantity"),
        type: "custom",
        layout: "full",
        component: ({ values }: FieldRenderProps) => {
          if (isCustomLine) return null;
          const quantity = normalizeNumber(values?.quantity, Number.NaN);
          const enteredUnit = normalizeUnitCode(values?.quantityUnit);
          if (!Number.isFinite(quantity) || quantity <= 0 || !enteredUnit) {
            return (
              <p className="text-xs text-muted-foreground">
                {t(
                  "sales.documents.items.uomPreviewEmpty",
                  "Select unit and quantity to preview normalization.",
                )}
              </p>
            );
          }
          const selectedOption =
            unitOptions.find((option) => option.code === enteredUnit) ?? null;
          const baseOption =
            unitOptions.find((option) => option.isBase) ?? null;
          const factor = selectedOption?.toBaseFactor;
          if (!Number.isFinite(factor) || !factor || !baseOption) {
            return (
              <p className="text-xs text-muted-foreground">
                {t(
                  "sales.documents.items.uomPreviewUnavailable",
                  "Missing conversion to base unit.",
                )}
              </p>
            );
          }
          const normalized = normalizeQuantityPreview(quantity * factor);
          return (
            <p className="text-xs text-muted-foreground">
              {t(
                "sales.documents.items.uomPreviewTemplate",
                "{{quantity}} {{unit}} → {{normalized}} {{baseUnit}}",
                {
                  quantity,
                  unit: enteredUnit,
                  normalized,
                  baseUnit: baseOption.code,
                },
              )}
            </p>
          );
        },
      } satisfies CrudField,
      {
        id: "statusEntryId",
        label: t("sales.documents.items.status", "Status"),
        type: "custom",
        layout: "half",
        component: ({ value, setValue }: FieldRenderProps) => (
          <LookupSelect
            value={typeof value === "string" ? value : null}
            onChange={(next) => setValue(next ?? null)}
            placeholder={t(
              "sales.documents.items.statusPlaceholder",
              "Select status",
            )}
            emptyLabel={t("sales.documents.items.statusEmpty", "No status")}
            fetchItems={fetchLineStatusItems}
            loadingLabel={t(
              "sales.documents.items.statusLoading",
              "Loading statuses…",
            )}
            selectLabel={t("ui.lookupSelect.select", "Select")}
            selectedLabel={t("ui.lookupSelect.selected", "Selected")}
            clearLabel={t("ui.lookupSelect.clearSelection", "Clear selection")}
            startTypingLabel={t(
              "ui.lookupSelect.startTyping",
              "Start typing to search.",
            )}
            minQuery={0}
          />
        ),
      } satisfies CrudField,
      {
        id: "name",
        label: t("sales.documents.items.name", "Name"),
        type: "text",
        placeholder: t(
          "sales.documents.items.namePlaceholder",
          "Optional line name",
        ),
        layout: "full",
        required: isCustomLine,
      } satisfies CrudField,
    ];
  }, [
    applyPriceSelection,
    convertUnitPriceForUnitChange,
    currencyCode,
    findTaxRateIdByValue,
    loadPrices,
    loadProductUnits,
    loadProductOptions,
    loadVariantOptions,
    fetchLineStatusItems,
    priceLoading,
    priceOptions,
    productOption,
    unitOptions,
    lineMode,
    variantOption,
    t,
    taxRateMap,
    taxRates,
    resolveTaxSelection,
    selectPriceAfterRefresh,
    hasTaxMetadata,
  ]);

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    return [
      { id: "line-core", fields },
      {
        id: "line-custom",
        column: 2,
        title: t("entities.customFields.title", "Custom fields"),
        kind: "customFields",
      },
    ];
  }, [fields, t]);

  React.useEffect(() => {
    if (!open) return;
    if (!initialLine) {
      resetForm();
      return;
    }
    setEditingId(initialLine.id);
    const nextForm = defaultForm(initialLine.currencyCode ?? currencyCode);
    const meta = initialLine.metadata ?? {};
    const snapshot =
      (initialLine.catalogSnapshot as
        | Record<string, unknown>
        | null
        | undefined) ?? null;
    const snapshotProduct =
      snapshot &&
      typeof snapshot === "object" &&
      typeof (snapshot as CatalogSnapshotRecord).product === "object" &&
      (snapshot as CatalogSnapshotRecord).product
        ? ((snapshot as CatalogSnapshotRecord).product as Record<string, unknown>)
        : null;
    const snapshotVariant =
      snapshot &&
      typeof snapshot === "object" &&
      typeof (snapshot as CatalogSnapshotRecord).variant === "object" &&
      (snapshot as CatalogSnapshotRecord).variant
        ? ((snapshot as CatalogSnapshotRecord).variant as Record<string, unknown>)
        : null;
    const metaRec = (typeof meta === "object" && meta ? meta : null) as LineMetadataRecord | null;
    const metaLineMode =
      typeof metaRec?.lineMode === "string" &&
      (metaRec.lineMode === "custom" || metaRec.lineMode === "catalog")
        ? (metaRec.lineMode as "custom" | "catalog")
        : metaRec?.customLine
          ? "custom"
          : undefined;
    nextForm.productId = initialLine.productId;
    nextForm.variantId = initialLine.productVariantId;
    nextForm.quantity = initialLine.quantity.toString();
    nextForm.quantityUnit = normalizeUnitCode(initialLine.quantityUnit) ?? null;
    const metaMode = metaRec?.priceMode;
    const resolvedPriceMode =
      metaMode === "net" || metaMode === "gross"
        ? metaMode
        : (initialLine.priceMode ?? "gross");
    nextForm.unitPrice =
      resolvedPriceMode === "net"
        ? initialLine.unitPriceNet.toString()
        : initialLine.unitPriceGross.toString();
    nextForm.priceMode = resolvedPriceMode;
    nextForm.taxRate = Number.isFinite(initialLine.taxRate)
      ? initialLine.taxRate
      : null;
    nextForm.name = initialLine.name ?? "";
    nextForm.catalogSnapshot = snapshot ?? null;
    nextForm.customFieldSetId = initialLine.customFieldSetId ?? null;
    nextForm.statusEntryId = initialLine.statusEntryId ?? null;
    nextForm.lineMode =
      metaLineMode ??
      (initialLine.productId || initialLine.productVariantId
        ? "catalog"
        : "custom");
    const metaTaxRateId =
      typeof metaRec?.taxRateId === "string"
        ? metaRec.taxRateId
        : null;
    const fallbackTaxRateId = findTaxRateIdByValue(nextForm.taxRate);
    nextForm.taxRateId =
      metaTaxRateId ??
      fallbackTaxRateId ??
      (defaultTaxRateRef.current ? defaultTaxRateRef.current.id : null);
    if (!Number.isFinite(nextForm.taxRate) && nextForm.taxRateId) {
      const matched = taxRatesRef.current.find(
        (rate) => rate.id === nextForm.taxRateId,
      );
      const numericRate = normalizeNumber(matched?.rate);
      if (Number.isFinite(numericRate)) {
        nextForm.taxRate = numericRate;
      }
    }
    let resolvedProductOption: ProductOption | null = null;
    let resolvedVariantOption: VariantOption | null = null;
    if (metaRec) {
      const metaRecord = metaRec;
      const mode = metaRecord.priceMode;
      if (mode === "net" || mode === "gross") {
        nextForm.priceMode = mode;
        nextForm.unitPrice =
          mode === "net"
            ? initialLine.unitPriceNet.toString()
            : initialLine.unitPriceGross.toString();
      }
      nextForm.priceId =
        typeof metaRecord.priceId === "string"
          ? metaRecord.priceId
          : null;
      const productTitle =
        typeof metaRecord.productTitle === "string"
          ? metaRecord.productTitle
          : initialLine.name;
      const productSku =
        typeof metaRecord.productSku === "string"
          ? metaRecord.productSku
          : null;
      const productThumbnail =
        typeof metaRecord.productThumbnail === "string"
          ? metaRecord.productThumbnail
          : null;
      if (productTitle && initialLine.productId) {
        const option = {
          id: initialLine.productId,
          title: productTitle,
          sku: productSku,
          thumbnailUrl: productThumbnail,
        };
        productOptionsRef.current.set(initialLine.productId, option);
        resolvedProductOption = option;
      }
      const variantTitle =
        typeof metaRecord.variantTitle === "string"
          ? metaRecord.variantTitle
          : null;
      const variantSku =
        typeof metaRecord.variantSku === "string"
          ? metaRecord.variantSku
          : null;
      const variantThumb =
        typeof metaRecord.variantThumbnail === "string"
          ? metaRecord.variantThumbnail
          : productThumbnail;
      if (variantTitle && initialLine.productVariantId) {
        const option = {
          id: initialLine.productVariantId,
          title: variantTitle,
          sku: variantSku,
          thumbnailUrl: variantThumb ?? null,
        };
        variantOptionsRef.current.set(initialLine.productVariantId, option);
        resolvedVariantOption = option;
      }
    }
    if (!resolvedProductOption && initialLine.productId && snapshotProduct) {
      const sp = snapshotProduct as SnapshotEntity;
      const snapshotTitle =
        typeof sp.title === "string" && sp.title.trim().length
          ? sp.title
          : (initialLine.name ?? initialLine.productId);
      const snapshotSku =
        typeof sp.sku === "string" && sp.sku.trim().length
          ? sp.sku
          : null;
      const snapshotThumb =
        typeof sp.thumbnailUrl === "string"
          ? sp.thumbnailUrl
          : typeof sp.thumbnail_url === "string"
            ? sp.thumbnail_url
            : null;
      const snapshotTaxRate = normalizeNumber(sp.taxRate, Number.NaN);
      const option: ProductOption = {
        id: initialLine.productId,
        title: snapshotTitle,
        sku: snapshotSku,
        thumbnailUrl: snapshotThumb,
        taxRateId: typeof sp.taxRateId === "string" ? sp.taxRateId : null,
        taxRate: Number.isFinite(snapshotTaxRate) ? snapshotTaxRate : null,
      };
      productOptionsRef.current.set(initialLine.productId, option);
      resolvedProductOption = option;
    }
    if (
      !resolvedVariantOption &&
      initialLine.productVariantId &&
      snapshotVariant
    ) {
      const sv = snapshotVariant as SnapshotEntity;
      const snapshotTitle =
        typeof sv.title === "string" && sv.title.trim().length
          ? sv.title
          : (initialLine.name ?? initialLine.productVariantId);
      const snapshotSku =
        typeof sv.sku === "string" && sv.sku.trim().length
          ? sv.sku
          : null;
      const snapshotThumb =
        typeof sv.thumbnailUrl === "string"
          ? sv.thumbnailUrl
          : typeof sv.thumbnail_url === "string"
            ? sv.thumbnail_url
            : (resolvedProductOption?.thumbnailUrl ??
              productOptionsRef.current.get(initialLine.productId ?? "")
                ?.thumbnailUrl ??
              null);
      const snapshotTaxRate = normalizeNumber(sv.taxRate, Number.NaN);
      const option: VariantOption = {
        id: initialLine.productVariantId,
        title: snapshotTitle,
        sku: snapshotSku,
        thumbnailUrl: snapshotThumb,
        taxRateId: typeof sv.taxRateId === "string" ? sv.taxRateId : null,
        taxRate: Number.isFinite(snapshotTaxRate) ? snapshotTaxRate : null,
      };
      variantOptionsRef.current.set(initialLine.productVariantId, option);
      resolvedVariantOption = option;
    }
    if (resolvedProductOption) setProductOption(resolvedProductOption);
    if (resolvedVariantOption) setVariantOption(resolvedVariantOption);
    const customValues = extractCustomFieldValues(
      initialLine as Record<string, unknown>,
    );
    const merged = { ...nextForm, ...customValues };
    setInitialValues(merged);
    setLineMode(merged.lineMode);
    setFormResetKey((prev) => prev + 1);
    if (initialLine.productId) {
      void loadProductUnits(initialLine.productId, resolvedProductOption).then(
        (options) => {
          const requestedUnit = normalizeUnitCode(nextForm.quantityUnit);
          if (
            requestedUnit &&
            !options.some((entry) => entry.code === requestedUnit)
          ) {
            setUnitOptions((prev) => [
              ...prev,
              { code: requestedUnit, toBaseFactor: null, isBase: false },
            ]);
          }
        },
      );
      void loadPrices(
        initialLine.productId,
        initialLine.productVariantId,
        nextForm.quantity,
        nextForm.quantityUnit,
      );
    } else {
      setPriceOptions([]);
      setUnitOptions([]);
    }
  }, [
    currencyCode,
    findTaxRateIdByValue,
    initialLine,
    loadPrices,
    loadProductUnits,
    open,
    resetForm,
  ]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}
    >
      <DialogContent
        className="sm:max-w-5xl"
        ref={dialogContentRef}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            dialogContentRef.current?.querySelector("form")?.requestSubmit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            closeDialog();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {editingId
              ? t("sales.documents.items.editTitle", "Edit line")
              : t("sales.documents.items.addTitle", "Add line")}
          </DialogTitle>
        </DialogHeader>
        <CrudForm<LineFormState>
          key={formResetKey}
          embedded
          fields={fields}
          groups={groups}
          entityId={customFieldEntityId}
          initialValues={initialValues}
          submitLabel={
            editingId
              ? t("sales.documents.items.save", "Save changes")
              : t("sales.documents.items.addLine", "Add item")
          }
          onSubmit={handleFormSubmit}
          loadingMessage={t("sales.documents.items.loading", "Loading items…")}
        />
      </DialogContent>
    </Dialog>
  );
}
