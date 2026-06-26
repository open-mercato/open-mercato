"use client";

import * as React from "react";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { Checkbox } from "@open-mercato/ui/primitives/checkbox";
import { Input } from "@open-mercato/ui/primitives/input";
import { Label } from "@open-mercato/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-mercato/ui/primitives/select";
import { Textarea } from "@open-mercato/ui/primitives/textarea";
import {
  CATALOG_EXCISE_CATEGORIES,
  CATALOG_GTU_CODES,
  CATALOG_HAZMAT_PACKING_GROUPS,
} from "../../data/types";
import type { ProductFormValues } from "./productForm";

const NONE_OPTION = "none";

type ProductComplianceSectionProps = {
  values: ProductFormValues;
  errors: Record<string, string>;
  setValue: (id: string, value: unknown) => void;
  embedded?: boolean;
};

function fieldErrorId(inputId: string) {
  return `${inputId}-error`;
}

function describedByError(
  inputId: string,
  message?: string,
): { "aria-invalid"?: true; "aria-describedby"?: string } {
  return message
    ? { "aria-invalid": true, "aria-describedby": fieldErrorId(inputId) }
    : {};
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  );
}

export function ProductComplianceSection({
  values,
  errors,
  setValue,
  embedded = false,
}: ProductComplianceSectionProps) {
  const t = useT();
  const gtuCodes = Array.isArray(values.gtuCodes) ? values.gtuCodes : [];

  const toggleGtuCode = React.useCallback(
    (code: string, checked: boolean) => {
      const current = Array.isArray(values.gtuCodes) ? values.gtuCodes : [];
      const next = checked
        ? Array.from(new Set([...current, code])).sort()
        : current.filter((entry) => entry !== code);
      setValue("gtuCodes", next);
    },
    [setValue, values.gtuCodes],
  );

  return (
    <div
      className={
        embedded ? "space-y-6" : "space-y-6 rounded-lg border bg-card p-4"
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {t("catalog.products.compliance.codes.title", "Compliance codes (PL/EU)")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t(
              "catalog.products.compliance.codes.description",
              "Classification codes used by KSeF/JPK invoices, customs declarations, and marketplace feeds.",
            )}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-country">
              {t("catalog.products.compliance.fields.countryOfOrigin", "Country of origin (ISO code)")}
            </Label>
            <Input
              id="catalog-product-compliance-country"
              value={values.countryOfOriginCode ?? ""}
              maxLength={2}
              placeholder={t("catalog.products.compliance.placeholders.countryOfOrigin", "PL")}
              onChange={(event) =>
                setValue("countryOfOriginCode", event.target.value.toUpperCase())
              }
              {...describedByError("catalog-product-compliance-country", errors.countryOfOriginCode)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-country")}
              message={errors.countryOfOriginCode}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-tax-classification">
              {t("catalog.products.compliance.fields.taxClassification", "Tax classification code")}
            </Label>
            <Input
              id="catalog-product-compliance-tax-classification"
              value={values.taxClassificationCode ?? ""}
              onChange={(event) => setValue("taxClassificationCode", event.target.value)}
              {...describedByError("catalog-product-compliance-tax-classification", errors.taxClassificationCode)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-tax-classification")}
              message={errors.taxClassificationCode}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-pkwiu">
              {t("catalog.products.compliance.fields.pkwiu", "PKWiU code")}
            </Label>
            <Input
              id="catalog-product-compliance-pkwiu"
              value={values.pkwiuCode ?? ""}
              onChange={(event) => setValue("pkwiuCode", event.target.value)}
              {...describedByError("catalog-product-compliance-pkwiu", errors.pkwiuCode)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-pkwiu")}
              message={errors.pkwiuCode}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-cn">
              {t("catalog.products.compliance.fields.cn", "CN code (Combined Nomenclature)")}
            </Label>
            <Input
              id="catalog-product-compliance-cn"
              value={values.cnCode ?? ""}
              onChange={(event) => setValue("cnCode", event.target.value)}
              {...describedByError("catalog-product-compliance-cn", errors.cnCode)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-cn")}
              message={errors.cnCode}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="catalog-product-compliance-hs">
              {t("catalog.products.compliance.fields.hs", "HS code (customs tariff)")}
            </Label>
            <Input
              id="catalog-product-compliance-hs"
              value={values.hsCode ?? ""}
              onChange={(event) => setValue("hsCode", event.target.value)}
              {...describedByError("catalog-product-compliance-hs", errors.hsCode)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-hs")}
              message={errors.hsCode}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label id="catalog-product-compliance-gtu-label">
            {t("catalog.products.compliance.fields.gtuCodes", "GTU codes (JPK_V7)")}
          </Label>
          <div
            role="group"
            aria-labelledby="catalog-product-compliance-gtu-label"
            className="grid gap-2 sm:grid-cols-3 md:grid-cols-4"
            {...describedByError("catalog-product-compliance-gtu", errors.gtuCodes)}
          >
            {CATALOG_GTU_CODES.map((code) => (
              <label
                key={code}
                className="flex items-center gap-2 text-sm"
                htmlFor={`catalog-product-compliance-gtu-${code}`}
              >
                <Checkbox
                  id={`catalog-product-compliance-gtu-${code}`}
                  checked={gtuCodes.includes(code)}
                  onCheckedChange={(checked) => toggleGtuCode(code, checked === true)}
                />
                {code.replace("_", " ")}
              </label>
            ))}
          </div>
          <FieldError
            id={fieldErrorId("catalog-product-compliance-gtu")}
            message={errors.gtuCodes}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {t("catalog.products.compliance.safety.title", "Restrictions & safety")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t(
              "catalog.products.compliance.safety.description",
              "Age, excise, and dangerous-goods attributes enforced by storefront, POS, and carriers.",
            )}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-age-min">
              {t("catalog.products.compliance.fields.ageMin", "Minimum buyer age")}
            </Label>
            <Input
              id="catalog-product-compliance-age-min"
              type="number"
              min={0}
              max={120}
              value={values.ageMin ?? ""}
              onChange={(event) => setValue("ageMin", event.target.value)}
              {...describedByError("catalog-product-compliance-age-min", errors.ageMin)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-age-min")}
              message={errors.ageMin}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-excise-category">
              {t("catalog.products.compliance.fields.exciseCategory", "Excise category")}
            </Label>
            <Select
              value={values.exciseCategory ?? NONE_OPTION}
              onValueChange={(value) =>
                setValue("exciseCategory", value === NONE_OPTION ? null : value)
              }
            >
              <SelectTrigger
                id="catalog-product-compliance-excise-category"
                {...describedByError("catalog-product-compliance-excise-category", errors.exciseCategory)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_OPTION}>
                  {t("catalog.products.compliance.options.none", "None")}
                </SelectItem>
                {CATALOG_EXCISE_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {t(`catalog.products.compliance.exciseCategories.${category}`, category)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError
              id={fieldErrorId("catalog-product-compliance-excise-category")}
              message={errors.exciseCategory}
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label
            className="flex items-center gap-2 text-sm"
            htmlFor="catalog-product-compliance-excise"
          >
            <Checkbox
              id="catalog-product-compliance-excise"
              checked={values.isExciseGood === true}
              onCheckedChange={(checked) => setValue("isExciseGood", checked === true)}
            />
            {t("catalog.products.compliance.fields.isExciseGood", "Excise good")}
          </label>
          <label
            className="flex items-center gap-2 text-sm"
            htmlFor="catalog-product-compliance-prescription"
          >
            <Checkbox
              id="catalog-product-compliance-prescription"
              checked={values.requiresPrescription === true}
              onCheckedChange={(checked) => setValue("requiresPrescription", checked === true)}
            />
            {t("catalog.products.compliance.fields.requiresPrescription", "Requires prescription")}
          </label>
          <label
            className="flex items-center gap-2 text-sm"
            htmlFor="catalog-product-compliance-lithium"
          >
            <Checkbox
              id="catalog-product-compliance-lithium"
              checked={values.containsLithiumBattery === true}
              onCheckedChange={(checked) => setValue("containsLithiumBattery", checked === true)}
            />
            {t("catalog.products.compliance.fields.containsLithiumBattery", "Contains lithium battery")}
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-hazmat-class">
              {t("catalog.products.compliance.fields.hazmatClass", "Hazmat class (ADR)")}
            </Label>
            <Input
              id="catalog-product-compliance-hazmat-class"
              value={values.hazmatClass ?? ""}
              onChange={(event) => setValue("hazmatClass", event.target.value)}
              {...describedByError("catalog-product-compliance-hazmat-class", errors.hazmatClass)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-hazmat-class")}
              message={errors.hazmatClass}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-un-number">
              {t("catalog.products.compliance.fields.unNumber", "UN number")}
            </Label>
            <Input
              id="catalog-product-compliance-un-number"
              placeholder={t("catalog.products.compliance.placeholders.unNumber", "UN1234")}
              value={values.unNumber ?? ""}
              onChange={(event) => setValue("unNumber", event.target.value)}
              {...describedByError("catalog-product-compliance-un-number", errors.unNumber)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-un-number")}
              message={errors.unNumber}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-packing-group">
              {t("catalog.products.compliance.fields.hazmatPackingGroup", "Packing group")}
            </Label>
            <Select
              value={values.hazmatPackingGroup ?? NONE_OPTION}
              onValueChange={(value) =>
                setValue("hazmatPackingGroup", value === NONE_OPTION ? null : value)
              }
            >
              <SelectTrigger
                id="catalog-product-compliance-packing-group"
                {...describedByError("catalog-product-compliance-packing-group", errors.hazmatPackingGroup)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_OPTION}>
                  {t("catalog.products.compliance.options.none", "None")}
                </SelectItem>
                {CATALOG_HAZMAT_PACKING_GROUPS.map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError
              id={fieldErrorId("catalog-product-compliance-packing-group")}
              message={errors.hazmatPackingGroup}
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {t("catalog.products.compliance.logistics.title", "Availability & lifecycle")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t(
              "catalog.products.compliance.logistics.description",
              "Launch, end-of-life, and selling windows plus shipping requirements.",
            )}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-launch-at">
              {t("catalog.products.compliance.fields.launchAt", "Launch date")}
            </Label>
            <Input
              id="catalog-product-compliance-launch-at"
              type="date"
              value={values.launchAt ?? ""}
              onChange={(event) => setValue("launchAt", event.target.value)}
              {...describedByError("catalog-product-compliance-launch-at", errors.launchAt)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-launch-at")}
              message={errors.launchAt}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-eol-at">
              {t("catalog.products.compliance.fields.endOfLifeAt", "End of life")}
            </Label>
            <Input
              id="catalog-product-compliance-eol-at"
              type="date"
              value={values.endOfLifeAt ?? ""}
              onChange={(event) => setValue("endOfLifeAt", event.target.value)}
              {...describedByError("catalog-product-compliance-eol-at", errors.endOfLifeAt)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-eol-at")}
              message={errors.endOfLifeAt}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-available-from">
              {t("catalog.products.compliance.fields.availableFrom", "Available from")}
            </Label>
            <Input
              id="catalog-product-compliance-available-from"
              type="date"
              value={values.availableFrom ?? ""}
              onChange={(event) => setValue("availableFrom", event.target.value)}
              {...describedByError("catalog-product-compliance-available-from", errors.availableFrom)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-available-from")}
              message={errors.availableFrom}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-available-until">
              {t("catalog.products.compliance.fields.availableUntil", "Available until")}
            </Label>
            <Input
              id="catalog-product-compliance-available-until"
              type="date"
              value={values.availableUntil ?? ""}
              onChange={(event) => setValue("availableUntil", event.target.value)}
              {...describedByError("catalog-product-compliance-available-until", errors.availableUntil)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-available-until")}
              message={errors.availableUntil}
            />
          </div>
        </div>
        <label
          className="flex items-center gap-2 text-sm"
          htmlFor="catalog-product-compliance-requires-shipping"
        >
          <Checkbox
            id="catalog-product-compliance-requires-shipping"
            checked={values.requiresShipping !== false}
            onCheckedChange={(checked) => setValue("requiresShipping", checked === true)}
          />
          {t("catalog.products.compliance.fields.requiresShipping", "Requires shipping")}
        </label>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {t("catalog.products.compliance.commercial.title", "Commercial terms")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t(
              "catalog.products.compliance.commercial.description",
              "Order quantity constraints and quote-only selling for B2B.",
            )}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-min-qty">
              {t("catalog.products.compliance.fields.minOrderQty", "Minimum order quantity")}
            </Label>
            <Input
              id="catalog-product-compliance-min-qty"
              type="number"
              min={1}
              value={values.minOrderQty ?? ""}
              onChange={(event) => setValue("minOrderQty", event.target.value)}
              {...describedByError("catalog-product-compliance-min-qty", errors.minOrderQty)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-min-qty")}
              message={errors.minOrderQty}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-max-qty">
              {t("catalog.products.compliance.fields.maxOrderQty", "Maximum order quantity")}
            </Label>
            <Input
              id="catalog-product-compliance-max-qty"
              type="number"
              min={1}
              value={values.maxOrderQty ?? ""}
              onChange={(event) => setValue("maxOrderQty", event.target.value)}
              {...describedByError("catalog-product-compliance-max-qty", errors.maxOrderQty)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-max-qty")}
              message={errors.maxOrderQty}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-qty-increment">
              {t("catalog.products.compliance.fields.orderQtyIncrement", "Quantity increment")}
            </Label>
            <Input
              id="catalog-product-compliance-qty-increment"
              type="number"
              min={1}
              value={values.orderQtyIncrement ?? ""}
              onChange={(event) => setValue("orderQtyIncrement", event.target.value)}
              {...describedByError("catalog-product-compliance-qty-increment", errors.orderQtyIncrement)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-qty-increment")}
              message={errors.orderQtyIncrement}
            />
          </div>
        </div>
        <label
          className="flex items-center gap-2 text-sm"
          htmlFor="catalog-product-compliance-quote-only"
        >
          <Checkbox
            id="catalog-product-compliance-quote-only"
            checked={values.isQuoteOnly === true}
            onCheckedChange={(checked) => setValue("isQuoteOnly", checked === true)}
          />
          {t("catalog.products.compliance.fields.isQuoteOnly", "Quote only (price on request)")}
        </label>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {t("catalog.products.compliance.seo.title", "SEO")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t(
              "catalog.products.compliance.seo.description",
              "Storefront metadata. Title and description are translatable per locale.",
            )}
          </p>
        </div>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-seo-title">
              {t("catalog.products.compliance.fields.seoTitle", "SEO title")}
            </Label>
            <Input
              id="catalog-product-compliance-seo-title"
              maxLength={255}
              value={values.seoTitle ?? ""}
              onChange={(event) => setValue("seoTitle", event.target.value)}
              {...describedByError("catalog-product-compliance-seo-title", errors.seoTitle)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-seo-title")}
              message={errors.seoTitle}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-seo-description">
              {t("catalog.products.compliance.fields.seoDescription", "SEO description")}
            </Label>
            <Textarea
              id="catalog-product-compliance-seo-description"
              rows={3}
              maxLength={1000}
              value={values.seoDescription ?? ""}
              onChange={(event) => setValue("seoDescription", event.target.value)}
              {...describedByError("catalog-product-compliance-seo-description", errors.seoDescription)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-seo-description")}
              message={errors.seoDescription}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-product-compliance-canonical-url">
              {t("catalog.products.compliance.fields.canonicalUrl", "Canonical URL")}
            </Label>
            <Input
              id="catalog-product-compliance-canonical-url"
              type="url"
              maxLength={500}
              placeholder="https://"
              value={values.canonicalUrl ?? ""}
              onChange={(event) => setValue("canonicalUrl", event.target.value)}
              {...describedByError("catalog-product-compliance-canonical-url", errors.canonicalUrl)}
            />
            <FieldError
              id={fieldErrorId("catalog-product-compliance-canonical-url")}
              message={errors.canonicalUrl}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
