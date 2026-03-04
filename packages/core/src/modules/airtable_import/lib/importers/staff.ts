import type { ImportRecordInput, ImportRecordResult } from "./types";
import { postToOmApi } from "./types";

const STAFF_FIELD_MAP: Record<string, string> = {
  name: "displayName",
  imie_nazwisko: "displayName",
  display_name: "displayName",
  description: "description",
  opis: "description",
};

export async function importStaffMember(
  input: ImportRecordInput,
): Promise<ImportRecordResult> {
  const mapped: Record<string, unknown> = {
    id: input.omId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  };

  for (const [omKey, value] of Object.entries(input.fields)) {
    const apiField = STAFF_FIELD_MAP[omKey.toLowerCase()];
    if (apiField) mapped[apiField] = value;
    else mapped[omKey] = value;
  }

  if (!mapped.displayName) {
    const first = input.fields["first_name"] ?? input.fields["imie"] ?? "";
    const last = input.fields["last_name"] ?? input.fields["nazwisko"] ?? "";
    mapped.displayName =
      [first, last].filter(Boolean).join(" ") || input.airtableId;
  }

  return postToOmApi(
    "/api/staff/team-members",
    mapped,
    input.omUrl,
    input.omApiKey,
  );
}
