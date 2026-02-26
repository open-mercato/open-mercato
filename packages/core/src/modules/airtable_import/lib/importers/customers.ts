import type { ImportRecordInput, ImportRecordResult } from "./types";
import { postToOmApi } from "./types";

const PEOPLE_FIELD_MAP: Record<string, string> = {
  first_name: "firstName",
  imie: "firstName",
  last_name: "lastName",
  nazwisko: "lastName",
  email: "primaryEmail",
  primary_email: "primaryEmail",
  phone: "primaryPhone",
  telefon: "primaryPhone",
  primary_phone: "primaryPhone",
  job_title: "jobTitle",
  stanowisko: "jobTitle",
  department: "department",
  dzial: "department",
  linkedin: "linkedInUrl",
  linkedin_url: "linkedInUrl",
  description: "description",
  opis: "description",
  status: "status",
  airtable_id: "airtableId",
};

// Keys that contain a full name (first + last combined) — split on last space
const FULL_NAME_KEYS = new Set([
  "name",
  "full_name",
  "fullname",
  "imie_i_nazwisko",
  "imię_i_nazwisko",
  "nazwisko_i_imie",
  "nazwisko_i_imię",
  "pelne_imie",
  "pełne_imię",
]);

function splitFullName(fullName: string): {
  firstName: string;
  lastName?: string;
} {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  const lastName = parts.pop()!;
  return { firstName: parts.join(" "), lastName };
}

export async function importPerson(
  input: ImportRecordInput,
): Promise<ImportRecordResult> {
  const mapped: Record<string, unknown> = {
    id: input.omId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  };

  for (const [omKey, value] of Object.entries(input.fields)) {
    const key = omKey.toLowerCase();
    if (
      FULL_NAME_KEYS.has(key) &&
      typeof value === "string" &&
      !mapped.firstName &&
      !mapped.lastName
    ) {
      const { firstName, lastName } = splitFullName(value);
      mapped.firstName = firstName;
      if (lastName) mapped.lastName = lastName;
      continue;
    }
    const apiField = PEOPLE_FIELD_MAP[key];
    if (apiField) mapped[apiField] = value;
    else mapped[omKey] = value;
  }

  if (!mapped.firstName && !mapped.lastName) {
    mapped.firstName =
      (mapped.displayName as string | undefined) ?? input.airtableId;
  }

  if (!mapped.displayName) {
    mapped.displayName =
      [mapped.firstName, mapped.lastName].filter(Boolean).join(" ") ||
      input.airtableId;
  }

  return postToOmApi(
    "/api/customers/people",
    mapped,
    input.omUrl,
    input.omApiKey,
  );
}

const COMPANY_FIELD_MAP: Record<string, string> = {
  name: "displayName",
  nazwa: "displayName",
  company_name: "displayName",
  nazwa_firmy: "displayName",
  email: "primaryEmail",
  primary_email: "primaryEmail",
  phone: "primaryPhone",
  telefon: "primaryPhone",
  website: "websiteUrl",
  strona: "websiteUrl",
  website_url: "websiteUrl",
  industry: "industry",
  branza: "industry",
  revenue: "annualRevenue",
  przychod: "annualRevenue",
  description: "description",
  opis: "description",
  status: "status",
};

export async function importCompany(
  input: ImportRecordInput,
): Promise<ImportRecordResult> {
  const mapped: Record<string, unknown> = {
    id: input.omId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  };

  for (const [omKey, value] of Object.entries(input.fields)) {
    const apiField = COMPANY_FIELD_MAP[omKey.toLowerCase()];
    if (apiField) mapped[apiField] = value;
    else mapped[omKey] = value;
  }

  if (!mapped.displayName) {
    mapped.displayName = mapped.name ?? input.airtableId;
  }

  return postToOmApi(
    "/api/customers/companies",
    mapped,
    input.omUrl,
    input.omApiKey,
  );
}

const DEAL_FIELD_MAP: Record<string, string> = {
  title: "title",
  tytul: "title",
  nazwa: "title",
  amount: "valueAmount",
  value: "valueAmount",
  wartosc: "valueAmount",
  kwota: "valueAmount",
  currency: "valueCurrency",
  waluta: "valueCurrency",
  stage: "pipelineStage",
  etap: "pipelineStage",
  probability: "probability",
  prawdopodobienstwo: "probability",
  close_date: "expectedCloseAt",
  data_zamkniecia: "expectedCloseAt",
  description: "description",
  opis: "description",
  status: "status",
};

export async function importDeal(
  input: ImportRecordInput,
): Promise<ImportRecordResult> {
  const mapped: Record<string, unknown> = {
    id: input.omId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  };

  for (const [omKey, value] of Object.entries(input.fields)) {
    const apiField = DEAL_FIELD_MAP[omKey.toLowerCase()];
    if (apiField) mapped[apiField] = value;
    else mapped[omKey] = value;
  }

  if (!mapped.title) mapped.title = input.airtableId;

  return postToOmApi(
    "/api/customers/deals",
    mapped,
    input.omUrl,
    input.omApiKey,
  );
}
