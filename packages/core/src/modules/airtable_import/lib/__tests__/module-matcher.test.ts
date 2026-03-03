import { matchTableToModule } from "../module-matcher";
import type { AirtableTableSchema } from "../../data/entities";

function makeTable(
  name: string,
  fields: { name: string; type: string }[],
): AirtableTableSchema {
  return {
    id: "tbl1",
    name,
    primaryFieldId: "fld1",
    fields: fields.map((f, i) => ({
      id: `fld${i}`,
      name: f.name,
      type: f.type,
    })),
  };
}

describe("matchTableToModule", () => {
  it('matches "Klienci" with email field to customers.people with high confidence', () => {
    const table = makeTable("Klienci", [
      { name: "Imię", type: "singleLineText" },
      { name: "Email", type: "email" },
      { name: "Telefon", type: "phoneNumber" },
    ]);
    const result = matchTableToModule(table);
    expect(result.targetModule).toBe("customers.people");
    expect(result.confidence).toBeGreaterThan(70);
  });

  it('matches "Produkty" with price and sku to catalog.products', () => {
    const table = makeTable("Produkty", [
      { name: "Nazwa", type: "singleLineText" },
      { name: "Cena", type: "currency" },
      { name: "SKU", type: "singleLineText" },
    ]);
    const result = matchTableToModule(table);
    expect(result.targetModule).toBe("catalog.products");
    expect(result.confidence).toBeGreaterThan(70);
  });

  it("returns null targetModule for unrecognized table", () => {
    const table = makeTable("Misc", [
      { name: "Pole1", type: "singleLineText" },
    ]);
    const result = matchTableToModule(table);
    expect(result.targetModule).toBeNull();
    expect(result.confidence).toBeLessThan(40);
  });

  describe("module recognition", () => {
    it.each<[string, { name: string; type: string }[], string | null]>([
      [
        "Contacts",
        [{ name: "Email", type: "email" }],
        "customers.people",
      ],
      [
        "Zamówienia",
        [
          { name: "Numer", type: "autoNumber" },
          { name: "Total", type: "currency" },
          { name: "Status", type: "singleSelect" },
        ],
        "sales.orders",
      ],
      [
        "Firmy",
        [
          { name: "Nazwa", type: "singleLineText" },
          { name: "NIP", type: "singleLineText" },
        ],
        "customers.companies",
      ],
      [
        "Zadania",
        [
          { name: "Tytuł", type: "singleLineText" },
          { name: "Termin", type: "date" },
          { name: "Przypisane do", type: "singleLineText" },
        ],
        "planner.tasks",
      ],
      [
        "Pracownicy",
        [
          { name: "Imię", type: "singleLineText" },
          { name: "Dział", type: "singleLineText" },
          { name: "Stanowisko", type: "singleLineText" },
        ],
        "staff.members",
      ],
      [
        "Employees",
        [
          { name: "Name", type: "singleLineText" },
          { name: "Department", type: "singleLineText" },
          { name: "Hire Date", type: "date" },
        ],
        "staff.members",
      ],
    ])('matchTableToModule("%s") → %s', (tableName, fields, expectedModule) => {
      const table = makeTable(tableName, fields);
      const result = matchTableToModule(table);
      expect(result.targetModule).toBe(expectedModule);
    });
  });
});
