import en from "../i18n/en.json";
import de from "../i18n/de.json";
import es from "../i18n/es.json";
import ko from "../i18n/ko.json";
import pl from "../i18n/pl.json";

const locales: Record<string, Record<string, string>> = { en, de, es, ko, pl };

const SITE_ERROR_KEYS = [
  "wms.sites.errors.duplicateCode",
  "wms.sites.errors.invalidInput",
  "wms.sites.errors.warehouseAssignedToActiveSite",
  "wms.sites.errors.warehouseMustBeActive",
  "wms.sites.errors.warehouseNotFound",
  "wms.sites.roles.errors.defaultConflict",
  "wms.sites.roles.errors.defaultDeletion",
  "wms.sites.roles.errors.defaultInvariant",
  "wms.sites.roles.errors.defaultRemoval",
  "wms.sites.roles.errors.duplicateWarehouse",
  "wms.sites.roles.errors.notFound",
  "wms.sites.validation.code",
  "wms.sites.validation.id",
  "wms.sites.validation.isDefault",
  "wms.sites.validation.mutableFieldRequired",
  "wms.sites.validation.name",
  "wms.sites.validation.role",
  "wms.sites.validation.warehouse",
] as const;

describe("WMS Site translations", () => {
  it("defines every backend and validation message in every supported locale", () => {
    for (const [locale, dictionary] of Object.entries(locales)) {
      for (const key of SITE_ERROR_KEYS) {
        expect(dictionary[key]).toEqual(expect.any(String));
        expect(dictionary[key]).not.toHaveLength(0);
      }
    }
  });

  it("does not fall back to the English conflict messages outside English", () => {
    const conflictKeys = [
      "wms.sites.errors.duplicateCode",
      "wms.sites.roles.errors.defaultConflict",
      "wms.sites.roles.errors.duplicateWarehouse",
    ] as const;
    for (const [locale, dictionary] of Object.entries(locales)) {
      if (locale === "en") continue;
      for (const key of conflictKeys) {
        expect(dictionary[key]).not.toBe(en[key]);
      }
    }
  });
});
