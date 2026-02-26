import { transformFieldValue } from "../field-transformers";

describe("transformFieldValue", () => {
  it("passes text values through", () => {
    expect(transformFieldValue("singleLineText", "hello")).toBe("hello");
  });

  it("converts number to number", () => {
    expect(transformFieldValue("number", 42)).toBe(42);
  });

  it("converts currency string to number", () => {
    expect(transformFieldValue("currency", 1234.56)).toBe(1234.56);
  });

  it("converts checkbox true to boolean", () => {
    expect(transformFieldValue("checkbox", true)).toBe(true);
    expect(transformFieldValue("checkbox", false)).toBe(false);
  });

  it("converts date string to ISO date string", () => {
    expect(transformFieldValue("date", "2023-03-15")).toBe("2023-03-15");
  });

  it("converts singleSelect to string", () => {
    expect(transformFieldValue("singleSelect", "Active")).toBe("Active");
  });

  it("converts multipleSelects array to array", () => {
    expect(transformFieldValue("multipleSelects", ["A", "B"])).toEqual([
      "A",
      "B",
    ]);
  });

  it("converts formula result to string", () => {
    expect(transformFieldValue("formula", 42)).toBe("42");
    expect(transformFieldValue("formula", "hello")).toBe("hello");
    expect(transformFieldValue("formula", null)).toBeNull();
  });

  it("returns null for null values", () => {
    expect(transformFieldValue("singleLineText", null)).toBeNull();
    expect(transformFieldValue("number", null)).toBeNull();
  });

  it("converts attachment array — returns empty array (attachments handled separately)", () => {
    const result = transformFieldValue("multipleAttachments", [
      { url: "http://...", filename: "file.pdf" },
    ]);
    expect(result).toEqual([]);
  });

  it("skips relation fields — returns null", () => {
    expect(
      transformFieldValue("multipleRecordLinks", ["rec1", "rec2"]),
    ).toBeNull();
  });
});
