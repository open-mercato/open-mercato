import { expect, test, type Locator, type Page } from "@playwright/test";
import { login } from "@open-mercato/core/helpers/integration/auth";

async function openScreen(page: Page, screenId: string) {
  await login(page, "superadmin");
  await page.goto(`/backend/finance-preview#${screenId}`);
  await expect(page.getByTestId("finance-preview")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByTestId(`tax-spec-${screenId}`)).toBeVisible();
  await page
    .getByRole("button", { name: "Zacznij ten proces od nowa", exact: true })
    .click();
}
async function captureResult(page: Page, screenId: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: test.info().outputPath(`finance-${screenId}-result-desktop.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await page.screenshot({
    path: test.info().outputPath(`finance-${screenId}-result-mobile.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
}
const input = (form: Locator, id: string) =>
  form.locator(`[data-crud-field-id="${id}"] input`).first();
async function select(page: Page, form: Locator, id: string, label: string) {
  await form
    .locator(`[data-crud-field-id="${id}"]`)
    .getByRole("combobox")
    .click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

test("tax liability recalculation supersedes drafts, posts once and confirms payment with a reference", async ({
  page,
}) => {
  await openScreen(page, "s53");
  const form = page.locator("#tax-liability-form");
  await select(page, form, "debitAccount", "221 — VAT należny");
  await select(page, form, "inputAccount", "220 — VAT naliczony");
  await select(page, form, "payableAccount", "222 — Rozrachunki VAT");
  await form
    .getByRole("button", { name: "Oblicz i sprawdź dekret", exact: true })
    .click();
  await expect(
    page.getByRole("row", { name: /222.*3\s?000,00/ }).first(),
  ).toBeVisible();
  await input(form, "input").fill("2500");
  await form
    .getByRole("button", { name: "Oblicz i sprawdź dekret", exact: true })
    .click();
  await expect(
    page.getByText("Zastąpiono nowszym wyliczeniem", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Zaksięguj rozliczenie", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Zaksięguj rozliczenie", exact: true }),
  ).toBeDisabled();
  const payment = page.locator("#tax-payment-form");
  await input(payment, "paidAt").fill("2026-10-01");
  await input(payment, "reference").fill("DEMO-BANK-012");
  await payment
    .getByRole("button", { name: "Potwierdź wykonanie płatności", exact: true })
    .click();
  await expect(
    page.getByText(/Płatność potwierdzona w historii scenariusza/),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(/DEMO-BANK-012/)).toBeVisible();
  await captureResult(page, "s53");
  const records = await page.evaluate(
    () =>
      JSON.parse(
        sessionStorage.getItem("finance-preview-tax-spec-s53-v1") ?? "{}",
      ).records,
  );
  expect(records.map((record: { status: string }) => record.status)).toEqual([
    "superseded",
    "paid",
  ]);
});

test("KSeF duplicate links an existing AP draft, preserves identity and prevents another create", async ({
  page,
}) => {
  await openScreen(page, "s54");
  await page
    .getByRole("row", { name: /FZ\/09\/2026\/091.*Polstar/ })
    .getByRole("button", { name: "Otwórz szczegóły" })
    .click();
  const form = page.locator("#ksef-draft-form");
  await select(page, form, "expense", "402 — Usługi obce");
  await form
    .getByRole("button", { name: "Utwórz szkic zakupu", exact: true })
    .click();
  await expect(
    page.getByText(/Istnieje już faktura tego dostawcy/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Powiąż istniejący szkic", exact: true })
    .click();
  await expect(
    page.getByText("Szkic zobowiązania — FZ/09/2026/091", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Utwórz szkic zakupu", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Otwórz powiązany szkic", exact: true })
    .click();
  await expect(
    page.getByText("Szkic zobowiązania — FZ/09/2026/091", { exact: true }),
  ).toBeVisible();
});

test("VAT reconciliation refuses a quarter and permits JPK despite explained difference", async ({
  page,
}) => {
  await openScreen(page, "s55");
  const form = page.locator("#vat-reconciliation-form");
  await select(
    page,
    form,
    "period",
    "III kwartał 2026 — wymaga wyboru miesiąca",
  );
  await select(page, form, "inputAccount", "220 — VAT naliczony");
  await select(page, form, "outputAccount", "221 — VAT należny");
  await form
    .getByRole("button", { name: "Porównaj rejestr i księgę", exact: true })
    .click();
  await expect(
    page
      .getByText(
        "Wybierz jeden miesiąc oraz oddzielne konta VAT należnego i naliczonego.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await select(page, form, "period", "Wrzesień 2026 — otwarty");
  await form
    .getByRole("button", { name: "Porównaj rejestr i księgę", exact: true })
    .click();
  await expect(
    page.getByRole("row", { name: /VAT naliczony.*230,00/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Przejdź do JPK_V7", exact: true })
    .click();
  await expect(page).toHaveURL(/#s37$/);
});

test("annual books preview preserves RPD, exports sample data and permits rejected delivery retry and correction", async ({
  page,
}) => {
  await openScreen(page, "s56");
  const form = page.locator("#jpk-books-form");
  await select(page, form, "marker", "Wynik finansowy — mapowanie przykładowe");
  await input(form, "rpd4").fill("1250");
  await form
    .getByRole("button", { name: "Sprawdź i wygeneruj podgląd", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Pobierz dane przykładowe CSV", exact: true })
    .click();
  expect((await downloadPromise).suggestedFilename()).toContain("przyklad.csv");
  await page
    .getByRole("button", {
      name: "Sprawdź przykładowy przebieg wysyłki",
      exact: true,
    })
    .click();
  await page
    .getByRole("radio", {
      name: "Odrzucenie: brak przypisania konta",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Uruchom symulację wysyłki", exact: true })
    .click();
  await expect(
    page.getByText(/Bramka demonstracyjna odrzuciła plik/),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "Przyjęcie danych", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Uruchom symulację wysyłki", exact: true })
    .click();
  await expect(page.getByText(/To nie jest UPO/)).toBeVisible();
  await page.reload();
  await expect(page.locator("#jpk-books-form")).toHaveCount(0);
  await captureResult(page, "s56");
  await page
    .getByRole("button", { name: "Utwórz szkic korekty", exact: true })
    .click();
  await expect(input(page.locator("#jpk-books-form"), "rpd4")).toHaveValue(
    "1250",
  );
});

test("statements expose wrong mapping, calculate both variants and validate resolution against the profit", async ({
  page,
}) => {
  await openScreen(page, "s57");
  const form = page.locator("#annual-statement-form");
  await select(page, form, "mapping", "Aktywa — pozostałe należności");
  await form
    .getByRole("button", { name: "Wygeneruj sprawozdania", exact: true })
    .click();
  await expect(page.getByText(/Bilans nie jest zrównoważony/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Pobierz dane przykładowe CSV",
      exact: true,
    }),
  ).toBeDisabled();
  await select(page, form, "mapping", "Pasywa — zysk (strata) netto");
  await form
    .getByRole("button", { name: "Wygeneruj sprawozdania", exact: true })
    .click();
  await expect(
    page.getByRole("row", { name: /Aktywa razem.*1\s300\s000,00/ }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "RZiS — wariant porównawczy", exact: true })
    .click();
  await expect(
    page.getByRole("row", { name: /Zysk \(strata\) netto.*250\s000,00/ }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "RZiS — wariant kalkulacyjny", exact: true })
    .click();
  await expect(
    page.getByRole("row", { name: /Zysk \(strata\) netto.*250\s000,00/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Uchwała o podziale zysku", exact: true })
    .click();
  const resolution = page.locator("#closing-resolution-form");
  await input(resolution, "retained").fill("200000");
  await input(resolution, "note").fill("UCH/2025/01");
  await resolution
    .getByRole("button", { name: "Zapisz wynik uchwały", exact: true })
    .click();
  await expect(
    page.getByText(/Suma podziału musi być równa wynikowi netto/).first(),
  ).toBeVisible();
  await input(resolution, "dividend").fill("50000");
  await resolution
    .getByRole("button", { name: "Zapisz wynik uchwały", exact: true })
    .click();
  await expect(
    page.getByText(/Uchwała zapisana dla bieżącego zamknięcia/),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("UCH/2025/01", { exact: true })).toBeVisible();
  await captureResult(page, "s57");
});
