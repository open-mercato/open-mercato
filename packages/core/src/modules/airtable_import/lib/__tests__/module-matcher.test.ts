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

  it('matches "Contacts" with email to customers.people', () => {
    const table = makeTable("Contacts", [{ name: "Email", type: "email" }]);
    const result = matchTableToModule(table);
    expect(result.targetModule).toBe("customers.people");
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

  it('matches "Zamówienia" with total to sales.orders', () => {
    const table = makeTable("Zamówienia", [
      { name: "Numer", type: "autoNumber" },
      { name: "Total", type: "currency" },
      { name: "Status", type: "singleSelect" },
    ]);
    const result = matchTableToModule(table);
    expect(result.targetModule).toBe("sales.orders");
  });

  it("returns null targetModule for unrecognized table", () => {
    const table = makeTable("Misc", [
      { name: "Pole1", type: "singleLineText" },
    ]);
    const result = matchTableToModule(table);
    expect(result.targetModule).toBeNull();
    expect(result.confidence).toBeLessThan(40);
  });

  it('matches "Firmy" with NIP field to customers.companies', () => {
    const table = makeTable("Firmy", [
      { name: "Nazwa", type: "singleLineText" },
      { name: "NIP", type: "singleLineText" },
    ]);
    const result = matchTableToModule(table);
    expect(result.targetModule).toBe("customers.companies");
  });

  it('matches "Zadania" with due_date to planner.tasks', () => {
    const table = makeTable("Zadania", [
      { name: "Tytuł", type: "singleLineText" },
      { name: "Termin", type: "date" },
      { name: "Przypisane do", type: "singleLineText" },
    ]);
    const result = matchTableToModule(table);
    expect(result.targetModule).toBe("planner.tasks");
  });

  it('matches "Pracownicy" with department field to staff.members', () => {
    const table = makeTable("Pracownicy", [
      { name: "Imię", type: "singleLineText" },
      { name: "Dział", type: "singleLineText" },
      { name: "Stanowisko", type: "singleLineText" },
    ]);
    const result = matchTableToModule(table);
    expect(result.targetModule).toBe("staff.members");
  });

  it('matches "Employees" with hire_date to staff.members', () => {
    const table = makeTable("Employees", [
      { name: "Name", type: "singleLineText" },
      { name: "Department", type: "singleLineText" },
      { name: "Hire Date", type: "date" },
    ]);
    const result = matchTableToModule(table);
    expect(result.targetModule).toBe("staff.members");
  });
});
