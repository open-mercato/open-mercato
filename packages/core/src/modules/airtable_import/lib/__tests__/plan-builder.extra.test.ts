import { buildPlan } from "../plan-builder";
import type { AirtableSchema, ImportMapping } from "../../data/entities";

// Minimal valid AirtableSchema — buildPlan does not read schema fields directly,
// only mapping.tables drives the output, but the type is required.
const minimalSchema: AirtableSchema = {
  baseId: "appTest",
  baseName: "Test Base",
  tables: [],
  collaborators: [],
};

function makeMapping(tables: ImportMapping["tables"]): ImportMapping {
  return { tables };
}

describe("buildPlan", () => {
  describe("structure of returned ImportPlan", () => {
    it("returns an object with tables, importOrder, users, totalRecords, generatedAt", () => {
      const mapping = makeMapping([]);
      const plan = buildPlan(minimalSchema, mapping, {});

      expect(plan).toHaveProperty("tables");
      expect(plan).toHaveProperty("importOrder");
      expect(plan).toHaveProperty("users");
      expect(plan).toHaveProperty("totalRecords");
      expect(plan).toHaveProperty("generatedAt");
    });

    it("returns users as an empty object", () => {
      const mapping = makeMapping([]);
      const plan = buildPlan(minimalSchema, mapping, {});
      expect(plan.users).toEqual({});
    });

    it("sets generatedAt to an ISO timestamp string", () => {
      const before = new Date().toISOString();
      const plan = buildPlan(minimalSchema, makeMapping([]), {});
      const after = new Date().toISOString();

      expect(plan.generatedAt >= before).toBe(true);
      expect(plan.generatedAt <= after).toBe(true);
    });
  });

  describe("empty mapping — no tables", () => {
    it("produces zero totalRecords when mapping has no tables", () => {
      const plan = buildPlan(minimalSchema, makeMapping([]), {});
      expect(plan.totalRecords).toBe(0);
    });

    it("produces an empty importOrder when mapping has no tables", () => {
      const plan = buildPlan(minimalSchema, makeMapping([]), {});
      expect(plan.importOrder).toEqual([]);
    });

    it("produces an empty tables object when mapping has no tables", () => {
      const plan = buildPlan(minimalSchema, makeMapping([]), {});
      expect(plan.tables).toEqual({});
    });
  });

  describe("skipped tables — excluded from plan", () => {
    it("does not include skipped tables in the output tables map", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblSkipped",
          airtableTableName: "Skipped Table",
          targetModule: "customers",
          targetEntitySlug: "person",
          confidence: 0.9,
          skip: true,
          fieldMappings: [],
        },
      ]);
      const plan = buildPlan(minimalSchema, mapping, { tblSkipped: ["recA"] });

      expect(plan.tables).not.toHaveProperty("tblSkipped");
    });

    it("does not count skipped table records in totalRecords", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblSkipped",
          airtableTableName: "Skipped",
          targetModule: null,
          targetEntitySlug: null,
          confidence: 0,
          skip: true,
          fieldMappings: [],
        },
      ]);
      const plan = buildPlan(minimalSchema, mapping, {
        tblSkipped: ["recA", "recB", "recC"],
      });

      expect(plan.totalRecords).toBe(0);
    });

    it("does not include skipped tables in importOrder", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblSkipped",
          airtableTableName: "Skipped",
          targetModule: null,
          targetEntitySlug: null,
          confidence: 0,
          skip: true,
          fieldMappings: [],
        },
      ]);
      const plan = buildPlan(minimalSchema, mapping, {});

      expect(plan.importOrder).not.toContain("tblSkipped");
    });
  });

  describe("active tables — record count and structure", () => {
    it("includes active table in the tables map with correct metadata", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblContacts",
          airtableTableName: "Contacts",
          targetModule: "customers",
          targetEntitySlug: "person",
          confidence: 0.95,
          skip: false,
          fieldMappings: [],
        },
      ]);
      const plan = buildPlan(minimalSchema, mapping, {
        tblContacts: ["recA", "recB"],
      });
      const tableEntry = plan.tables["tblContacts"];

      expect(tableEntry).toBeDefined();
      expect(tableEntry.airtableTableId).toBe("tblContacts");
      expect(tableEntry.airtableTableName).toBe("Contacts");
      expect(tableEntry.targetModule).toBe("customers");
      expect(tableEntry.targetEntitySlug).toBe("person");
    });

    it("counts records in totalRecords for active tables", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblContacts",
          airtableTableName: "Contacts",
          targetModule: "customers",
          targetEntitySlug: "person",
          confidence: 0.9,
          skip: false,
          fieldMappings: [],
        },
      ]);
      const plan = buildPlan(minimalSchema, mapping, {
        tblContacts: ["recA", "recB", "recC"],
      });

      expect(plan.totalRecords).toBe(3);
    });

    it("sums totalRecords across multiple active tables", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblA",
          airtableTableName: "A",
          targetModule: "customers",
          targetEntitySlug: "person",
          confidence: 0.9,
          skip: false,
          fieldMappings: [],
        },
        {
          airtableTableId: "tblB",
          airtableTableName: "B",
          targetModule: "customers",
          targetEntitySlug: "company",
          confidence: 0.8,
          skip: false,
          fieldMappings: [],
        },
      ]);
      const plan = buildPlan(minimalSchema, mapping, {
        tblA: ["rec1", "rec2"],
        tblB: ["rec3", "rec4", "rec5"],
      });

      expect(plan.totalRecords).toBe(5);
    });

    it("treats missing allRecordIds entry as zero records for that table", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblNoIds",
          airtableTableName: "No IDs",
          targetModule: "customers",
          targetEntitySlug: "person",
          confidence: 0.5,
          skip: false,
          fieldMappings: [],
        },
      ]);
      // allRecordIds does not contain 'tblNoIds'
      const plan = buildPlan(minimalSchema, mapping, {});

      expect(plan.tables["tblNoIds"].records).toEqual([]);
      expect(plan.totalRecords).toBe(0);
    });
  });

  describe("UUID generation per record", () => {
    it("assigns a unique omId UUID to every record", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblX",
          airtableTableName: "X",
          targetModule: "customers",
          targetEntitySlug: "person",
          confidence: 0.9,
          skip: false,
          fieldMappings: [],
        },
      ]);
      const plan = buildPlan(minimalSchema, mapping, {
        tblX: ["recA", "recB", "recC"],
      });
      const ids = plan.tables["tblX"].records.map((r) => r.omId);

      // All IDs are defined strings
      ids.forEach((id) => expect(typeof id).toBe("string"));

      // All IDs are unique
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it("preserves the original airtable record IDs", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblX",
          airtableTableName: "X",
          targetModule: "customers",
          targetEntitySlug: "person",
          confidence: 0.9,
          skip: false,
          fieldMappings: [],
        },
      ]);
      const plan = buildPlan(minimalSchema, mapping, {
        tblX: ["recAlpha", "recBeta"],
      });
      const airtableIds = plan.tables["tblX"].records.map((r) => r.airtableId);

      expect(airtableIds).toEqual(["recAlpha", "recBeta"]);
    });

    it("initialises originalCreatedAt and originalUpdatedAt to null for every record", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblY",
          airtableTableName: "Y",
          targetModule: "customers",
          targetEntitySlug: "person",
          confidence: 0.9,
          skip: false,
          fieldMappings: [],
        },
      ]);
      const plan = buildPlan(minimalSchema, mapping, { tblY: ["recZ"] });
      const record = plan.tables["tblY"].records[0];

      expect(record.originalCreatedAt).toBeNull();
      expect(record.originalUpdatedAt).toBeNull();
    });

    it("generates different omIds across separate buildPlan calls for the same airtable record", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblX",
          airtableTableName: "X",
          targetModule: "customers",
          targetEntitySlug: "person",
          confidence: 0.9,
          skip: false,
          fieldMappings: [],
        },
      ]);
      const planA = buildPlan(minimalSchema, mapping, { tblX: ["recSame"] });
      const planB = buildPlan(minimalSchema, mapping, { tblX: ["recSame"] });

      const idA = planA.tables["tblX"].records[0].omId;
      const idB = planB.tables["tblX"].records[0].omId;

      expect(idA).not.toBe(idB);
    });
  });

  describe("importOrder", () => {
    it("includes all active (non-skipped) table IDs in importOrder", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblA",
          airtableTableName: "A",
          targetModule: null,
          targetEntitySlug: null,
          confidence: 0,
          skip: false,
          fieldMappings: [],
        },
        {
          airtableTableId: "tblB",
          airtableTableName: "B",
          targetModule: null,
          targetEntitySlug: null,
          confidence: 0,
          skip: false,
          fieldMappings: [],
        },
        {
          airtableTableId: "tblSkip",
          airtableTableName: "Skip",
          targetModule: null,
          targetEntitySlug: null,
          confidence: 0,
          skip: true,
          fieldMappings: [],
        },
      ]);
      const plan = buildPlan(minimalSchema, mapping, {});

      expect(plan.importOrder).toContain("tblA");
      expect(plan.importOrder).toContain("tblB");
      expect(plan.importOrder).not.toContain("tblSkip");
      expect(plan.importOrder).toHaveLength(2);
    });

    it("mixed skipped and active tables — only active appear in importOrder and tables map", () => {
      const mapping = makeMapping([
        {
          airtableTableId: "tblActive",
          airtableTableName: "Active",
          targetModule: "customers",
          targetEntitySlug: "person",
          confidence: 0.9,
          skip: false,
          fieldMappings: [],
        },
        {
          airtableTableId: "tblInactive",
          airtableTableName: "Inactive",
          targetModule: null,
          targetEntitySlug: null,
          confidence: 0,
          skip: true,
          fieldMappings: [],
        },
      ]);
      const plan = buildPlan(minimalSchema, mapping, { tblActive: ["recX"] });

      expect(Object.keys(plan.tables)).toEqual(["tblActive"]);
      expect(plan.importOrder).toEqual(["tblActive"]);
    });
  });
});
