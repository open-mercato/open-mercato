jest.mock("../../../lib/unitCodes", () => ({
  canonicalizeUnitCode: (value: unknown) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed.toLowerCase() : null;
  },
}));

jest.mock("@open-mercato/ui/backend/utils/serverErrors", () => ({
  createCrudFormError: (message: string, fieldErrors?: Record<string, string>) => {
    const err = new Error(message) as Error & { fieldErrors?: Record<string, string> };
    err.fieldErrors = fieldErrors;
    return err;
  },
}));

import {
  toTrimmedOrNull,
  parseNumericInput,
  toPositiveNumberOrNull,
  toIntegerInRangeOrDefault,
  normalizeProductConversionInputs,
  UNIT_PRICE_REFERENCE_UNITS,
} from "../productFormUtils";

describe("UNIT_PRICE_REFERENCE_UNITS", () => {
  it("contains exactly kg, l, m2, m3, pc", () => {
    expect(UNIT_PRICE_REFERENCE_UNITS).toEqual(new Set(["kg", "l", "m2", "m3", "pc"]));
    expect(UNIT_PRICE_REFERENCE_UNITS.size).toBe(5);
  });
});

describe("toTrimmedOrNull", () => {
  it("returns null for non-string input", () => {
    expect(toTrimmedOrNull(42)).toBeNull();
    expect(toTrimmedOrNull(null)).toBeNull();
    expect(toTrimmedOrNull(undefined)).toBeNull();
  });

  it("returns null for empty or whitespace-only strings", () => {
    expect(toTrimmedOrNull("")).toBeNull();
    expect(toTrimmedOrNull("   ")).toBeNull();
    expect(toTrimmedOrNull("\t\n")).toBeNull();
  });

  it("trims and returns valid strings", () => {
    expect(toTrimmedOrNull("hello")).toBe("hello");
    expect(toTrimmedOrNull("  hello  ")).toBe("hello");
    expect(toTrimmedOrNull(" a ")).toBe("a");
  });
});

describe("parseNumericInput", () => {
  it("returns the number for numeric input", () => {
    expect(parseNumericInput(5)).toBe(5);
    expect(parseNumericInput(0)).toBe(0);
    expect(parseNumericInput(-3.14)).toBe(-3.14);
  });

  it("parses string numbers", () => {
    expect(parseNumericInput("42")).toBe(42);
    expect(parseNumericInput("3.14")).toBe(3.14);
    expect(parseNumericInput("-7")).toBe(-7);
  });

  it("replaces commas with dots", () => {
    expect(parseNumericInput("3,14")).toBe(3.14);
    expect(parseNumericInput("1,234,56")).toBeNaN();
  });

  it("strips whitespace", () => {
    expect(parseNumericInput("  42  ")).toBe(42);
    expect(parseNumericInput(" 1 000 ")).toBe(1000);
  });

  it("returns NaN for empty string", () => {
    expect(parseNumericInput("")).toBeNaN();
    expect(parseNumericInput("   ")).toBeNaN();
  });

  it("returns NaN for non-numeric strings", () => {
    expect(parseNumericInput("abc")).toBeNaN();
    expect(parseNumericInput("hello world")).toBeNaN();
  });
});

describe("toPositiveNumberOrNull", () => {
  it("returns number for positive values", () => {
    expect(toPositiveNumberOrNull(5)).toBe(5);
    expect(toPositiveNumberOrNull(0.001)).toBe(0.001);
  });

  it("returns null for zero", () => {
    expect(toPositiveNumberOrNull(0)).toBeNull();
  });

  it("returns null for negative values", () => {
    expect(toPositiveNumberOrNull(-1)).toBeNull();
    expect(toPositiveNumberOrNull(-100)).toBeNull();
  });

  it("returns null for NaN and Infinity", () => {
    expect(toPositiveNumberOrNull(NaN)).toBeNull();
    expect(toPositiveNumberOrNull(Infinity)).toBeNull();
    expect(toPositiveNumberOrNull(-Infinity)).toBeNull();
  });

  it("parses positive strings", () => {
    expect(toPositiveNumberOrNull("10")).toBe(10);
    expect(toPositiveNumberOrNull("3,5")).toBe(3.5);
  });
});

describe("toIntegerInRangeOrDefault", () => {
  it("returns value when in range", () => {
    expect(toIntegerInRangeOrDefault(5, 0, 10, 99)).toBe(5);
    expect(toIntegerInRangeOrDefault(0, 0, 10, 99)).toBe(0);
    expect(toIntegerInRangeOrDefault(10, 0, 10, 99)).toBe(10);
  });

  it("returns fallback for non-integer", () => {
    expect(toIntegerInRangeOrDefault(3.5, 0, 10, 99)).toBe(99);
    expect(toIntegerInRangeOrDefault("2.7", 0, 10, 99)).toBe(99);
  });

  it("returns fallback when below min", () => {
    expect(toIntegerInRangeOrDefault(-1, 0, 10, 99)).toBe(99);
  });

  it("returns fallback when above max", () => {
    expect(toIntegerInRangeOrDefault(11, 0, 10, 99)).toBe(99);
  });

  it("returns fallback for NaN and non-numeric", () => {
    expect(toIntegerInRangeOrDefault("abc", 0, 10, 99)).toBe(99);
    expect(toIntegerInRangeOrDefault("", 0, 10, 99)).toBe(99);
    expect(toIntegerInRangeOrDefault(undefined, 0, 10, 99)).toBe(99);
  });
});

describe("normalizeProductConversionInputs", () => {
  it("returns empty array for undefined input", () => {
    expect(normalizeProductConversionInputs(undefined, "dup")).toEqual([]);
  });

  it("returns empty array for empty array input", () => {
    expect(normalizeProductConversionInputs([], "dup")).toEqual([]);
  });

  it("filters out rows with missing unitCode or toBaseFactor", () => {
    const rows = [
      { id: null, unitCode: "", toBaseFactor: "1", sortOrder: "0", isActive: true },
      { id: null, unitCode: "kg", toBaseFactor: "", sortOrder: "0", isActive: true },
      { id: null, unitCode: "   ", toBaseFactor: "5", sortOrder: "0", isActive: true },
      { id: null, unitCode: "kg", toBaseFactor: "-1", sortOrder: "0", isActive: true },
    ];
    expect(normalizeProductConversionInputs(rows, "dup")).toEqual([]);
  });

  it("normalizes valid rows with correct sortOrder", () => {
    const rows = [
      { id: "abc", unitCode: "kg", toBaseFactor: "1000", sortOrder: "5", isActive: true },
      { id: null, unitCode: "lb", toBaseFactor: "453.6", sortOrder: "invalid", isActive: false },
    ];
    const result = normalizeProductConversionInputs(rows, "dup");
    expect(result).toEqual([
      { id: "abc", unitCode: "kg", toBaseFactor: 1000, sortOrder: 5, isActive: true },
      { id: null, unitCode: "lb", toBaseFactor: 453.6, sortOrder: 10, isActive: false },
    ]);
  });

  it("throws on duplicate unit codes (case-insensitive)", () => {
    const rows = [
      { id: null, unitCode: "kg", toBaseFactor: "1000", sortOrder: "0", isActive: true },
      { id: null, unitCode: "KG", toBaseFactor: "500", sortOrder: "1", isActive: true },
    ];
    expect(() => normalizeProductConversionInputs(rows, "Duplicate unit")).toThrow("Duplicate unit");
    try {
      normalizeProductConversionInputs(rows, "Duplicate unit");
    } catch (error: unknown) {
      expect((error as Error & { fieldErrors?: Record<string, string> }).fieldErrors).toEqual({ unitConversions: "Duplicate unit" });
    }
  });

  it("sets isActive to true by default", () => {
    const rows = [
      { id: null, unitCode: "kg", toBaseFactor: "1000", sortOrder: "0", isActive: undefined as unknown as boolean },
    ];
    const result = normalizeProductConversionInputs(rows, "dup");
    expect(result[0].isActive).toBe(true);
  });
});
