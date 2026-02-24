import type { EntityManager } from "@mikro-orm/postgresql";
import { CrudHttpError } from "@open-mercato/shared/lib/crud/errors";
import { findOneWithDecryption } from "@open-mercato/shared/lib/encryption/find";
import {
  Dictionary,
  DictionaryEntry,
} from "@open-mercato/core/modules/dictionaries/data/entities";
import { canonicalizeUnitCode } from "./unitCodes";

const UOM_DICTIONARY_KEYS = ["unit", "units", "measurement_units"];

export async function resolveUnitDictionary(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
) {
  return findOneWithDecryption(
    em,
    Dictionary,
    {
      organizationId,
      tenantId,
      key: { $in: UOM_DICTIONARY_KEYS },
      deletedAt: null,
      isActive: true,
    },
    { orderBy: { createdAt: "asc" } },
  );
}

export async function resolveCanonicalUnitCode(
  em: EntityManager,
  params: {
    organizationId: string;
    tenantId: string;
    unitCode: string;
  },
): Promise<string> {
  const dictionary = await resolveUnitDictionary(
    em,
    params.organizationId,
    params.tenantId,
  );
  if (!dictionary) {
    return canonicalizeUnitCode(params.unitCode) ?? params.unitCode;
  }
  const unitCode = canonicalizeUnitCode(params.unitCode);
  if (!unitCode) {
    throw new CrudHttpError(400, { error: "uom.unit_not_found" });
  }
  const entry = await findOneWithDecryption(em, DictionaryEntry, {
    dictionary,
    organizationId: dictionary.organizationId,
    tenantId: dictionary.tenantId,
    $or: [{ normalizedValue: unitCode }, { value: unitCode }],
  });
  if (!entry) {
    throw new CrudHttpError(400, { error: "uom.unit_not_found" });
  }
  const canonical = typeof entry.value === "string" ? entry.value.trim() : "";
  return canonical.length ? canonical : unitCode;
}
