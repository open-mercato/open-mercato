import {
  mapAirtableFieldType,
  isRelationField,
  isComputedField,
  isSystemField,
} from "../schema-analyzer";

describe("mapAirtableFieldType", () => {
  it("maps singleLineText to text", () => {
    expect(mapAirtableFieldType("singleLineText")).toBe("text");
  });

  it("maps email to text", () => {
    expect(mapAirtableFieldType("email")).toBe("text");
  });

  it("maps multilineText to textarea", () => {
    expect(mapAirtableFieldType("multilineText")).toBe("textarea");
  });

  it("maps number to number", () => {
    expect(mapAirtableFieldType("number")).toBe("number");
  });

  it("maps currency to number", () => {
    expect(mapAirtableFieldType("currency")).toBe("number");
  });

  it("maps date and dateTime to date", () => {
    expect(mapAirtableFieldType("date")).toBe("date");
    expect(mapAirtableFieldType("dateTime")).toBe("date");
  });

  it("maps singleSelect to select", () => {
    expect(mapAirtableFieldType("singleSelect")).toBe("select");
  });

  it("maps multipleSelects to multi_select", () => {
    expect(mapAirtableFieldType("multipleSelects")).toBe("multi_select");
  });

  it("maps checkbox to boolean", () => {
    expect(mapAirtableFieldType("checkbox")).toBe("boolean");
  });

  it("maps formula and rollup to text", () => {
    expect(mapAirtableFieldType("formula")).toBe("text");
    expect(mapAirtableFieldType("rollup")).toBe("text");
  });

  it("returns text for unknown types", () => {
    expect(mapAirtableFieldType("unknownFutureType")).toBe("text");
  });
});

describe("isRelationField", () => {
  it("returns true for multipleRecordLinks", () => {
    expect(isRelationField("multipleRecordLinks")).toBe(true);
  });
  it("returns false for text", () => {
    expect(isRelationField("singleLineText")).toBe(false);
  });
});

describe("isComputedField", () => {
  it("returns true for formula, rollup, lookup, count", () => {
    expect(isComputedField("formula")).toBe(true);
    expect(isComputedField("rollup")).toBe(true);
    expect(isComputedField("lookup")).toBe(true);
    expect(isComputedField("count")).toBe(true);
  });
  it("returns false for regular fields", () => {
    expect(isComputedField("singleLineText")).toBe(false);
  });
});

describe("isSystemField", () => {
  it("returns true for createdTime, lastModifiedTime", () => {
    expect(isSystemField("createdTime")).toBe(true);
    expect(isSystemField("lastModifiedTime")).toBe(true);
  });
  it("returns false for regular fields", () => {
    expect(isSystemField("singleLineText")).toBe(false);
  });
});
