const FIELD_TYPE_MAP: Record<string, string> = {
  singleLineText: "text",
  email: "text",
  url: "text",
  phoneNumber: "text",
  multilineText: "textarea",
  richText: "textarea",
  number: "number",
  currency: "number",
  percent: "number",
  rating: "number",
  date: "date",
  dateTime: "date",
  singleSelect: "select",
  multipleSelects: "multi_select",
  checkbox: "boolean",
  formula: "text",
  rollup: "text",
  lookup: "text",
  count: "text",
  autoNumber: "text",
  barcode: "text",
  duration: "number",
};

const RELATION_TYPES = new Set(["multipleRecordLinks", "singleRecordLink"]);
const COMPUTED_TYPES = new Set(["formula", "rollup", "lookup", "count"]);
const SYSTEM_TYPES = new Set([
  "createdTime",
  "lastModifiedTime",
  "createdBy",
  "lastModifiedBy",
  "autoNumber",
]);

export function mapAirtableFieldType(airtableType: string): string {
  return FIELD_TYPE_MAP[airtableType] ?? "text";
}

export function isRelationField(airtableType: string): boolean {
  return RELATION_TYPES.has(airtableType);
}

export function isComputedField(airtableType: string): boolean {
  return COMPUTED_TYPES.has(airtableType);
}

export function isSystemField(airtableType: string): boolean {
  return SYSTEM_TYPES.has(airtableType);
}

const CREATED_AT_PATTERNS = [
  /creat/i,
  /added?/i,
  /insert/i,
  /utw(o|ó)rzon/i,
  /dodano/i,
  /data.?dodania/i,
  /data.?wstawie/i,
];
const UPDATED_AT_PATTERNS = [
  /modif/i,
  /updat/i,
  /edit/i,
  /chang/i,
  /edyto/i,
  /zmieni/i,
  /aktuali/i,
  /ostatni/i,
];

export function suggestDateMapping(
  fieldName: string,
): "created_at" | "updated_at" | null {
  const normalized = fieldName.toLowerCase().replace(/[_\s-]/g, "");
  if (CREATED_AT_PATTERNS.some((p) => p.test(normalized))) return "created_at";
  if (UPDATED_AT_PATTERNS.some((p) => p.test(normalized))) return "updated_at";
  return null;
}
