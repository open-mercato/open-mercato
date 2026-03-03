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

describe("transformFieldValue — edge cases", () => {
  describe("numeric types — string parsing and zero handling", () => {
    it.each<[string, unknown, number | null]>([
      ["number",   "42.5",        42.5],
      ["number",   "nie_liczba",  null],
      ["number",   0,             0],
      ["percent",  75.5,          75.5],
      ["rating",   3,             3],
      ["currency", "1234.56",     1234.56],
      ["duration", 90,            90],
      ["currency", "not-a-price", null],
    ])("transformFieldValue(%s, %j) → %j", (type, input, expected) => {
      expect(transformFieldValue(type, input)).toBe(expected);
    });
  });

  describe("string coercion — email, url, phoneNumber, autoNumber, barcode", () => {
    it.each<[string, unknown, string]>([
      ["email",       123,               "123"],
      ["url",         true,              "true"],
      ["phoneNumber", "+48 123 456 789", "+48 123 456 789"],
      ["autoNumber",  42,                "42"],
      ["barcode",     "ABC-123",         "ABC-123"],
    ])("transformFieldValue(%s, %j) → %j", (type, input, expected) => {
      expect(transformFieldValue(type, input as string)).toBe(expected);
    });
  });

  describe("multilineText and richText — string coercion", () => {
    it("passes through multilineText as string", () => {
      expect(transformFieldValue("multilineText", "line1\nline2")).toBe(
        "line1\nline2",
      );
    });

    it("coerces number to string for richText", () => {
      expect(transformFieldValue("richText", 99)).toBe("99");
    });
  });

  describe("checkbox — truthy/falsy coercion", () => {
    it.each<[unknown, boolean]>([
      [1,      true],
      [0,      false],
      ["true", true],
      ["",     false],
    ])("transformFieldValue(checkbox, %j) → %j", (input, expected) => {
      expect(transformFieldValue("checkbox", input)).toBe(expected);
    });
  });

  describe("multipleSelects — array and non-array input", () => {
    it("returns empty array for empty array input", () => {
      expect(transformFieldValue("multipleSelects", [])).toEqual([]);
    });

    it("coerces array of numbers to array of strings", () => {
      expect(transformFieldValue("multipleSelects", [1, 2, 3])).toEqual([
        "1",
        "2",
        "3",
      ]);
    });

    it("wraps non-array string in an array", () => {
      expect(transformFieldValue("multipleSelects", "single")).toEqual([
        "single",
      ]);
    });
  });

  describe("formula, rollup, lookup, count — value coercion", () => {
    it.each<[string, unknown, string]>([
      ["formula", { value: 42 }, "[object Object]"],
      ["rollup",  100,           "100"],
      ["lookup",  [1, 2],        "1,2"],
      ["count",   5,             "5"],
    ])("transformFieldValue(%s, %j) → %j", (type, input, expected) => {
      expect(transformFieldValue(type, input)).toBe(expected);
    });
  });

  describe("dateTime", () => {
    it("passes through ISO datetime string as-is", () => {
      expect(transformFieldValue("dateTime", "2023-03-15T10:30:00.000Z")).toBe(
        "2023-03-15T10:30:00.000Z",
      );
    });
  });

  describe("singleRecordLink", () => {
    it("returns null for singleRecordLink", () => {
      expect(transformFieldValue("singleRecordLink", "rec123")).toBeNull();
    });
  });

  describe("createdTime / lastModifiedTime", () => {
    it("returns null for createdTime even when value is present", () => {
      expect(
        transformFieldValue("createdTime", "2023-01-01T00:00:00.000Z"),
      ).toBeNull();
    });

    it("returns null for lastModifiedTime even when value is present", () => {
      expect(
        transformFieldValue("lastModifiedTime", "2023-06-15T12:00:00.000Z"),
      ).toBeNull();
    });
  });

  describe("createdBy / lastModifiedBy", () => {
    it("returns null for createdBy with collaborator object", () => {
      expect(
        transformFieldValue("createdBy", { id: "usr1", email: "a@b.com" }),
      ).toBeNull();
    });

    it("returns null for lastModifiedBy with collaborator object", () => {
      expect(
        transformFieldValue("lastModifiedBy", { id: "usr2", name: "Bob" }),
      ).toBeNull();
    });
  });

  describe("default (unknown type) — fallback string coercion", () => {
    it("passes through string for unknown type", () => {
      expect(transformFieldValue("unknownType", "hello")).toBe("hello");
    });

    it("coerces number to string for unknown type", () => {
      expect(transformFieldValue("unknownType", 42)).toBe("42");
    });

    it("coerces plain object to string for unknown type", () => {
      expect(transformFieldValue("unknownType", { complex: "obj" })).toBe(
        "[object Object]",
      );
    });
  });

  describe("undefined value — early null guard", () => {
    it.each(["singleLineText", "number", "checkbox"])(
      "returns null for undefined in %s type",
      (type) => {
        expect(transformFieldValue(type, undefined)).toBeNull();
      },
    );
  });
});
