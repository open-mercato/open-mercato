import { transformFieldValue } from "../field-transformers";

describe("transformFieldValue — edge cases", () => {
  describe("numeric types — string parsing and zero handling", () => {
    it('parses string "42.5" to float for number type', () => {
      expect(transformFieldValue("number", "42.5")).toBe(42.5);
    });

    it("returns null for non-numeric string in number type", () => {
      expect(transformFieldValue("number", "nie_liczba")).toBeNull();
    });

    it("returns 0 for number type with value 0 (not coerced to null)", () => {
      // typeof 0 === 'number' so the direct branch is taken, never reaching || null
      expect(transformFieldValue("number", 0)).toBe(0);
    });

    it("converts percent value 75.5 as number", () => {
      expect(transformFieldValue("percent", 75.5)).toBe(75.5);
    });

    it("converts rating integer 3 as number", () => {
      expect(transformFieldValue("rating", 3)).toBe(3);
    });

    it('parses currency string "1234.56" via parseFloat', () => {
      expect(transformFieldValue("currency", "1234.56")).toBe(1234.56);
    });

    it("converts duration number 90 as number", () => {
      expect(transformFieldValue("duration", 90)).toBe(90);
    });

    it("returns null for non-numeric string in currency type", () => {
      expect(transformFieldValue("currency", "not-a-price")).toBeNull();
    });
  });

  describe("string coercion — email, url, phoneNumber, autoNumber, barcode", () => {
    it("coerces number 123 to string for email type", () => {
      expect(transformFieldValue("email", 123)).toBe("123");
    });

    it("coerces boolean true to string for url type", () => {
      expect(transformFieldValue("url", true)).toBe("true");
    });

    it("passes through phone number string as-is", () => {
      expect(transformFieldValue("phoneNumber", "+48 123 456 789")).toBe(
        "+48 123 456 789",
      );
    });

    it("coerces number 42 to string for autoNumber type", () => {
      expect(transformFieldValue("autoNumber", 42)).toBe("42");
    });

    it("passes through barcode string as-is", () => {
      expect(transformFieldValue("barcode", "ABC-123")).toBe("ABC-123");
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
    it("converts number 1 to true", () => {
      expect(transformFieldValue("checkbox", 1)).toBe(true);
    });

    it("converts number 0 to false", () => {
      expect(transformFieldValue("checkbox", 0)).toBe(false);
    });

    it('converts truthy string "true" to true', () => {
      expect(transformFieldValue("checkbox", "true")).toBe(true);
    });

    it("converts empty string to false", () => {
      expect(transformFieldValue("checkbox", "")).toBe(false);
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
    it("converts object to string for formula type", () => {
      expect(transformFieldValue("formula", { value: 42 })).toBe(
        "[object Object]",
      );
    });

    it("converts number 100 to string for rollup type", () => {
      expect(transformFieldValue("rollup", 100)).toBe("100");
    });

    it("converts array to string for lookup type", () => {
      expect(transformFieldValue("lookup", [1, 2])).toBe("1,2");
    });

    it("converts number to string for count type", () => {
      expect(transformFieldValue("count", 5)).toBe("5");
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
    it("returns null when value is undefined for singleLineText", () => {
      expect(transformFieldValue("singleLineText", undefined)).toBeNull();
    });

    it("returns null when value is undefined for number type", () => {
      expect(transformFieldValue("number", undefined)).toBeNull();
    });

    it("returns null when value is undefined for checkbox type", () => {
      expect(transformFieldValue("checkbox", undefined)).toBeNull();
    });
  });
});
