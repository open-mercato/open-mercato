import {
  mapAirtableFieldType,
  isRelationField,
  isComputedField,
  isSystemField,
  suggestDateMapping,
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

describe("suggestDateMapping", () => {
  describe("created_at patterns — English", () => {
    it('returns created_at for field name "created_at"', () => {
      expect(suggestDateMapping("created_at")).toBe("created_at");
    });

    it('returns created_at for "createdAt" (camelCase)', () => {
      expect(suggestDateMapping("createdAt")).toBe("created_at");
    });

    it('returns created_at for "Date Created"', () => {
      expect(suggestDateMapping("Date Created")).toBe("created_at");
    });

    it('returns created_at for "inserted_at"', () => {
      expect(suggestDateMapping("inserted_at")).toBe("created_at");
    });

    it('returns created_at for "Added" (addedd pattern)', () => {
      expect(suggestDateMapping("Added")).toBe("created_at");
    });
  });

  describe("created_at patterns — Polish", () => {
    it('returns created_at for "Utworzono"', () => {
      expect(suggestDateMapping("Utworzono")).toBe("created_at");
    });

    it('returns created_at for "Dodano"', () => {
      expect(suggestDateMapping("Dodano")).toBe("created_at");
    });

    it('returns created_at for "Data dodania"', () => {
      expect(suggestDateMapping("Data dodania")).toBe("created_at");
    });

    it('returns created_at for "Data wstawienia"', () => {
      expect(suggestDateMapping("Data wstawienia")).toBe("created_at");
    });

    it('returns created_at for "Utwórzone" (with ó — full suffix required)', () => {
      // Pattern is /utw(o|ó)rzon/i — needs at least "utwórzon" to match.
      // "Utwórzone" contains the required suffix; bare "Utwórz" does not.
      expect(suggestDateMapping("Utwórzone")).toBe("created_at");
    });

    it('returns null for bare "Utwórz" which does not satisfy the rzon suffix', () => {
      expect(suggestDateMapping("Utwórz")).toBeNull();
    });
  });

  describe("updated_at patterns — English", () => {
    it('returns updated_at for "updated_at"', () => {
      expect(suggestDateMapping("updated_at")).toBe("updated_at");
    });

    it('returns updated_at for "Last Modified"', () => {
      expect(suggestDateMapping("Last Modified")).toBe("updated_at");
    });

    it('returns updated_at for "modified_at"', () => {
      expect(suggestDateMapping("modified_at")).toBe("updated_at");
    });

    it('returns updated_at for "Last Edited"', () => {
      expect(suggestDateMapping("Last Edited")).toBe("updated_at");
    });

    it('returns updated_at for "Last Changed"', () => {
      expect(suggestDateMapping("Last Changed")).toBe("updated_at");
    });
  });

  describe("updated_at patterns — Polish", () => {
    it('returns updated_at for "Ostatnia zmiana"', () => {
      expect(suggestDateMapping("Ostatnia zmiana")).toBe("updated_at");
    });

    it('returns updated_at for "Zaktualizowano"', () => {
      expect(suggestDateMapping("Zaktualizowano")).toBe("updated_at");
    });

    it('returns updated_at for "Zedytowano"', () => {
      expect(suggestDateMapping("Zedytowano")).toBe("updated_at");
    });

    it('returns updated_at for "Zmieniono"', () => {
      expect(suggestDateMapping("Zmieniono")).toBe("updated_at");
    });
  });

  describe("no match — unrelated field names", () => {
    it('returns null for "Name"', () => {
      expect(suggestDateMapping("Name")).toBeNull();
    });

    it('returns null for "Email"', () => {
      expect(suggestDateMapping("Email")).toBeNull();
    });

    it('returns null for "Status"', () => {
      expect(suggestDateMapping("Status")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(suggestDateMapping("")).toBeNull();
    });

    it('returns null for "ID"', () => {
      expect(suggestDateMapping("ID")).toBeNull();
    });

    it('returns null for "Notes"', () => {
      expect(suggestDateMapping("Notes")).toBeNull();
    });
  });

  describe("normalisation — separators stripped before pattern matching", () => {
    it('treats underscores and spaces as equivalent (created_at vs "created at")', () => {
      expect(suggestDateMapping("created at")).toBe("created_at");
      expect(suggestDateMapping("created_at")).toBe("created_at");
    });

    it('treats dashes as equivalent to underscores ("created-at")', () => {
      expect(suggestDateMapping("created-at")).toBe("created_at");
    });

    it('is case-insensitive ("CREATED_AT")', () => {
      expect(suggestDateMapping("CREATED_AT")).toBe("created_at");
    });

    it('is case-insensitive ("UPDATED_AT")', () => {
      expect(suggestDateMapping("UPDATED_AT")).toBe("updated_at");
    });
  });

  describe("created_at pattern takes priority over updated_at when both could match", () => {
    // "insert" is a created pattern; make sure priority is respected
    it('returns created_at for "insert" keyword', () => {
      expect(suggestDateMapping("insert")).toBe("created_at");
    });
  });
});

describe("isSystemField — additional cases not in existing tests", () => {
  it("returns true for createdBy", () => {
    expect(isSystemField("createdBy")).toBe(true);
  });

  it("returns true for lastModifiedBy", () => {
    expect(isSystemField("lastModifiedBy")).toBe(true);
  });

  it("returns true for autoNumber", () => {
    expect(isSystemField("autoNumber")).toBe(true);
  });

  it("returns false for singleSelect", () => {
    expect(isSystemField("singleSelect")).toBe(false);
  });

  it("returns false for number", () => {
    expect(isSystemField("number")).toBe(false);
  });
});

describe("isRelationField — additional cases not in existing tests", () => {
  it("returns true for singleRecordLink", () => {
    expect(isRelationField("singleRecordLink")).toBe(true);
  });

  it("returns false for lookup", () => {
    // lookup is computed, not a relation
    expect(isRelationField("lookup")).toBe(false);
  });

  it("returns false for formula", () => {
    expect(isRelationField("formula")).toBe(false);
  });
});

describe("mapAirtableFieldType — additional mappings not in existing tests", () => {
  it("maps url to text", () => {
    expect(mapAirtableFieldType("url")).toBe("text");
  });

  it("maps phoneNumber to text", () => {
    expect(mapAirtableFieldType("phoneNumber")).toBe("text");
  });

  it("maps richText to textarea", () => {
    expect(mapAirtableFieldType("richText")).toBe("textarea");
  });

  it("maps percent to number", () => {
    expect(mapAirtableFieldType("percent")).toBe("number");
  });

  it("maps rating to number", () => {
    expect(mapAirtableFieldType("rating")).toBe("number");
  });

  it("maps duration to number", () => {
    expect(mapAirtableFieldType("duration")).toBe("number");
  });

  it("maps lookup to text", () => {
    expect(mapAirtableFieldType("lookup")).toBe("text");
  });

  it("maps count to text", () => {
    expect(mapAirtableFieldType("count")).toBe("text");
  });

  it("maps barcode to text", () => {
    expect(mapAirtableFieldType("barcode")).toBe("text");
  });
});
