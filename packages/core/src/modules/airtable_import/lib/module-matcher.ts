import type { AirtableTableSchema } from "../data/entities";

export interface MatchResult {
  targetModule: string | null;
  confidence: number; // 0–100
}

interface ModulePattern {
  module: string;
  namePatterns: RegExp[];
  criticalFieldPatterns: RegExp[]; // +30 each
  supportingFieldPatterns: RegExp[]; // +10 each
  criticalFieldTypes: string[]; // +20 each
}

const MODULE_PATTERNS: ModulePattern[] = [
  {
    module: "customers.people",
    namePatterns: [
      /contacts?/i,
      /people/i,
      /persons?/i,
      /klienci/i,
      /kontakty/i,
      /osoby/i,
      /leads?/i,
      /prospekty/i,
      /subskrybenci/i,
      /kandydaci/i,
    ],
    criticalFieldPatterns: [
      /email/i,
      /telefon/i,
      /phone/i,
      /mobile/i,
      /kom[oó]rk/i,
    ],
    supportingFieldPatterns: [
      /imi[eę]/i,
      /first.?name/i,
      /last.?name/i,
      /nazwisko/i,
      /linkedin/i,
      /urodzin/i,
      /birthday/i,
    ],
    criticalFieldTypes: ["email", "phoneNumber"],
  },
  {
    module: "customers.companies",
    namePatterns: [
      /companies/i,
      /company/i,
      /firmy/i,
      /firma/i,
      /organizacj/i,
      /accounts?/i,
      /partnerzy/i,
      /przedsi[eę]biorst/i,
    ],
    criticalFieldPatterns: [
      /\bnip\b/i,
      /\bregon\b/i,
      /\bkrs\b/i,
      /vat.?number/i,
      /tax.?id/i,
    ],
    supportingFieldPatterns: [
      /company.?name/i,
      /nazwa.?firmy/i,
      /revenue/i,
      /przych[oó]d/i,
      /employees?/i,
      /pracownicy/i,
    ],
    criticalFieldTypes: [],
  },
  {
    module: "customers.deals",
    namePatterns: [
      /deals?/i,
      /okazje/i,
      /szanse/i,
      /pipeline/i,
      /opportunit/i,
      /transakcj/i,
    ],
    criticalFieldPatterns: [
      /\bamount\b/i,
      /\bvalue\b/i,
      /warto[sś][cć]/i,
      /\bstage\b/i,
      /\betap\b/i,
    ],
    supportingFieldPatterns: [
      /close.?date/i,
      /probabilit/i,
      /prawdopodobie/i,
      /won/i,
      /lost/i,
    ],
    criticalFieldTypes: ["currency"],
  },
  {
    module: "catalog.products",
    namePatterns: [
      /products?/i,
      /produkty/i,
      /produkt/i,
      /\bitems?\b/i,
      /artyku[łl]y/i,
      /towary/i,
      /asortyment/i,
      /katalog/i,
    ],
    criticalFieldPatterns: [
      /\bprice\b/i,
      /\bcena\b/i,
      /\bsku\b/i,
      /barcode/i,
      /\bean\b/i,
      /kod.?kreskowy/i,
    ],
    supportingFieldPatterns: [
      /weight/i,
      /waga/i,
      /stock/i,
      /stan/i,
      /kategor/i,
      /wymiar/i,
      /dimension/i,
    ],
    criticalFieldTypes: ["currency"],
  },
  {
    module: "catalog.categories",
    namePatterns: [/categor/i, /kategor/i, /grupy.?produkt/i, /typy.?produkt/i],
    criticalFieldPatterns: [],
    supportingFieldPatterns: [/parent/i, /rodzic/i, /slug/i, /sort/i],
    criticalFieldTypes: [],
  },
  {
    module: "sales.orders",
    namePatterns: [
      /orders?/i,
      /zam[oó]wienia/i,
      /zam[oó]wienie/i,
      /sprzeda[żz]/i,
      /zakupy/i,
    ],
    criticalFieldPatterns: [
      /order.?number/i,
      /nr.?zam/i,
      /\btotal\b/i,
      /kwota.?[łl][aą]czna/i,
    ],
    supportingFieldPatterns: [
      /payment/i,
      /p[łl]atno[sś][cć]/i,
      /shipping/i,
      /dostawa/i,
      /adres/i,
    ],
    criticalFieldTypes: [],
  },
  {
    module: "sales.invoices",
    namePatterns: [
      /invoices?/i,
      /faktury/i,
      /faktura/i,
      /rachunki/i,
      /rachunek/i,
    ],
    criticalFieldPatterns: [
      /invoice.?number/i,
      /nr.?faktury/i,
      /due.?date/i,
      /termin.?p[łl]atno/i,
      /\bvat\b/i,
    ],
    supportingFieldPatterns: [/paid/i, /op[łl]acono/i, /netto/i, /brutto/i],
    criticalFieldTypes: [],
  },
  {
    module: "planner.tasks",
    namePatterns: [
      /tasks?/i,
      /zadania/i,
      /zadanie/i,
      /todo/i,
      /checklist/i,
      /czynno[sś]ci/i,
      /dzia[łl]ania/i,
    ],
    criticalFieldPatterns: [
      /due.?date/i,
      /termin/i,
      /assigned/i,
      /przypisane/i,
    ],
    supportingFieldPatterns: [
      /priorit/i,
      /priorytet/i,
      /completed/i,
      /uko[nń]czon/i,
      /status/i,
    ],
    criticalFieldTypes: [],
  },
  {
    module: "staff.members",
    namePatterns: [
      /employees?/i,
      /pracownicy/i,
      /pracownik/i,
      /kadry/i,
      /\bhr\b/i,
      /personel/i,
      /\bteam\b/i,
      /zesp[oó][łl]/i,
      /staff/i,
    ],
    criticalFieldPatterns: [
      /department/i,
      /dzia[łl]/i,
      /stanowisko/i,
      /position/i,
      /salary/i,
      /wynagrodzenie/i,
    ],
    supportingFieldPatterns: [
      /hire.?date/i,
      /data.?zatrudn/i,
      /contract/i,
      /umowa/i,
      /etat/i,
    ],
    criticalFieldTypes: [],
  },
];

function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[ąa]/g, "a")
    .replace(/[ćc]/g, "c")
    .replace(/[ęe]/g, "e")
    .replace(/[łl]/g, "l")
    .replace(/[ńn]/g, "n")
    .replace(/[óo]/g, "o")
    .replace(/[śs]/g, "s")
    .replace(/[źżz]/g, "z")
    .replace(/[-_\s]/g, "");
}

export function matchTableToModule(table: AirtableTableSchema): MatchResult {
  let bestModule: string | null = null;
  let bestScore = 0;

  for (const pattern of MODULE_PATTERNS) {
    let score = 0;

    const normalizedName = normalize(table.name);
    for (const namePattern of pattern.namePatterns) {
      if (namePattern.test(normalizedName) || namePattern.test(table.name)) {
        score += 25;
        break;
      }
    }

    for (const field of table.fields) {
      const normalizedFieldName = normalize(field.name);

      for (const cp of pattern.criticalFieldPatterns) {
        if (cp.test(normalizedFieldName) || cp.test(field.name)) {
          score += 30;
          break;
        }
      }

      for (const sp of pattern.supportingFieldPatterns) {
        if (sp.test(normalizedFieldName) || sp.test(field.name)) {
          score += 10;
          break;
        }
      }

      if (pattern.criticalFieldTypes.includes(field.type)) {
        score += 20;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestModule = pattern.module;
    }
  }

  if (bestScore < 40) {
    return { targetModule: null, confidence: bestScore };
  }

  return {
    targetModule: bestModule,
    confidence: Math.min(100, bestScore),
  };
}
