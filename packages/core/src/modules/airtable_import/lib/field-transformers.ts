export function transformFieldValue(
  airtableType: string,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return null;

  switch (airtableType) {
    case "singleLineText":
    case "email":
    case "url":
    case "phoneNumber":
    case "singleSelect":
    case "autoNumber":
    case "barcode":
      return String(value);

    case "multilineText":
    case "richText":
      return String(value);

    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "duration":
      return typeof value === "number"
        ? value
        : parseFloat(String(value)) || null;

    case "checkbox":
      return Boolean(value);

    case "date":
    case "dateTime":
      return String(value);

    case "multipleSelects":
      return Array.isArray(value) ? value.map(String) : [String(value)];

    case "formula":
    case "rollup":
    case "lookup":
    case "count":
      if (value === null || value === undefined) return null;
      return typeof value === "string" ? value : String(value);

    case "multipleAttachments":
      // Attachments handled by separate attachment importer
      return [];

    case "multipleRecordLinks":
    case "singleRecordLink":
      // Relations handled in pass 2
      return null;

    case "createdTime":
    case "lastModifiedTime":
      // System timestamps handled via SQL patch in pass 3
      return null;

    case "createdBy":
    case "lastModifiedBy":
      return null;

    default:
      return value !== null && value !== undefined ? String(value) : null;
  }
}
