# Time Tracking — prototyp UI

Klikalne makiety 17 ekranów modułu śledzenia czasu, wyprowadzone z
[`2026-08-12-time-tracking-module-requirements.md`](../../specs/2026-08-12-time-tracking-module-requirements.md) (sekcje §1–§10 + mapa historyjek §11).

**Otwórz `index.html` w przeglądarce.** Działa przez `file://` — serwer nie jest potrzebny.

## Do czego to służy

Do wyłapania nieporozumień, zanim powstanie kod. Prototyp **wygląda jak produkcja**
(te same tokeny DS, ta sama anatomia AppShell / DataTable / CrudForm) i **zachowuje się jak
szkic** — nic nie zapisuje, nie liczy i nie waliduje.

## Tryby (pasek u góry)

| Tryb | Co robi |
|---|---|
| **Pokaż klikalne** | Podświetla wszystkie hotspoty i przygasza elementy, które nigdzie nie prowadzą. Kliknięcie w przygaszony przycisk nie działa — bo nie jest podpięty, a nie dlatego, że coś jest zepsute. |
| **Prezentacja** | Jeden ekran naraz, bez chrome'u dokumentu. `←Wstecz` i `Backspace` cofają. |
| **Komentarze** | Kliknięcie dowolnego elementu przypina wątek w tym miejscu. |
| **Motyw** | Przełącza jasny/ciemny. Oba są w zakresie — warto sprawdzić ekrany w obu. |

## Komentarze — ważne ograniczenie

**To nie jest komentowanie na żywo.** Wątki lądują w `localStorage` Twojej przeglądarki.
Nikt inny ich nie widzi, dopóki nie zrobisz:

```
piszesz → „Eksportuj do repo" → podmieniasz comments.js → commit/PR
```

Niewyeksportowane wątki mają pomarańczową pinezkę i etykietę „lokalny"; licznik w pasku
pokazuje, ile ich jest. Wątki, których kotwica przestała pasować po edycji makiety, trafiają
do sekcji „Odklejone wątki" — z zachowaną treścią, nigdy nie znikają po cichu.

Przy 2–3 recenzentach scalanie `comments.js` to sekunda (wątki mają unikalne `id`).
Przy większej grupie lepiej przenieść dyskusję na issues.

## Ekrany

| # | Ekran | Pokrywa |
|---|---|---|
| 1 | Moja praca (pulpit TM) | §3, §6 · US-A1, A2, D4 |
| 2 | Pusty stan — brak przypisań | §3 · US-A1 |
| 3 | Projekty (TL) | §2, §7 · US-A2, B3 |
| 4 | Nowy projekt | §2, §7, §9 · US-B1, F1 |
| 5 | Zespół projektu | §3 · US-B2 |
| 6 | Tablica Kanban | §4 · US-C1, C2, C5, D4 |
| 7 | Szczegóły zadania | §4, §5 · US-C3, C4, C5, D4 |
| 8 | Wpis czasu — formularz | §5, §7 · US-D1, D2, D3, F2 |
| 9 | Wpis czasu — błędy i nakładanie | §5 · US-D2, D7 |
| 10 | Wpisy czasu — lista | §5, §7 · US-D5, D6, F2, G3 |
| 11 | Timesheet — miesiąc | §6 · US-E1, E2, E3, E4 |
| 12 | Timesheet — tydzień | §6 · US-E1, E3, E4 |
| 13 | Raport — konfiguracja | §8 · US-G1 |
| 14 | Raport — podgląd i eksport | §8, §9 · US-G2, G4 |
| 15 | Blokada i odblokowanie wpisów | §9 · US-G3 |
| 16 | Ustawienia — zaokrąglanie | §9, §10 · US-F3 |
| 17 | Brak dostępu | §3 · US-A2 |

Ekrany 2, 9 i 17 to stany brzegowe innych ekranów — nie prowadzi do nich żaden hotspot,
otwiera się je z paska nawigacji u góry.

## Czego prototyp NIE jest

**Nie jest wzorcem do skopiowania do kodu.** Dwa świadome odstępstwa od produkcji:

- **Ikony** to wklejony sprite SVG z lucide, nie importy `lucide-react`.
- **Teksty** są zaszyte w HTML, nie przepuszczone przez `useT()`.

Oba są niedopuszczalne w kodzie produkcyjnym. Prototyp odwzorowuje **układ**, nie implementację.

## Pliki

```
index.html       ← ekrany (jedyny plik, który się edytuje przy zmianie makiet)
tokens.css       ← GENEROWANY z apps/mercato/src/app/globals.css — nie edytuj ręcznie
components.css   ← odpowiedniki prymitywów @open-mercato/ui
screens.css      ← powłoka, chrome DataTable, Kanban, timesheet, arkusz raportu
prototype.css    ← warstwa trybu klikalnego i komentarzy
prototype.js     ← silnik: hotspoty, prezentacja, komentarze, eksport
comments.js      ← zatwierdzone wątki (commitowane)
```

Po zmianie design systemu:

```bash
node ../../skills/om-mockup-prototype/scripts/sync-tokens.mjs .          # regeneruj
node ../../skills/om-mockup-prototype/scripts/sync-tokens.mjs --check .  # sam audyt
```

**Nie zmieniaj `id="sN"` sekcji** po tym, jak ktoś zaczął komentować — kotwice wątków się na nich opierają.
