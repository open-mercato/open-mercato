---
name: om-mockup-prototype
description: Buduje klikalny prototyp UI z komentarzami na podstawie dokumentu wymagań — makiety wszystkich ekranów w Open Mercato Design System, tryb klikalny do przeklikania przepływu i tryb komentarzy do dyskusji przed implementacją. Najpierw sprawdza, czy wymagania zawierają historyjki użytkownika, a gdy ich brak — proponuje wygenerowanie mapy US. Używaj, gdy ktoś prosi o mockup, makietę, prototyp, wireframe, podgląd ekranów albo o zebranie feedbacku do wymagań przed kodowaniem.
---

Prototyp powstaje **przed** implementacją i służy do jednego: wyłapania nieporozumień, gdy zmiana kosztuje minutę, a nie tydzień. Wszystko poniżej jest tego podporządkowane.

## Zasada nadrzędna

Prototyp ma **wyglądać jak produkcja i zachowywać się jak szkic**. Wygląd bierz z realnych komponentów (`references/screen-patterns.md`) — makieta, która różni się układem od produkcji, generuje uwagi do rzeczy, które i tak wyglądają inaczej. Zachowanie może być statyczne, ale **nigdy nie udawaj działania, którego nie ma**: pole, które wygląda na edytowalne i nic nie robi, kosztuje recenzenta więcej niż jego brak.

---

## Krok 1 — Sprawdź historyjki użytkownika (ZAWSZE PIERWSZY)

Przeczytaj wskazany dokument wymagań i ustal, czy zawiera **historyjki użytkownika z kryteriami akceptacji**.

Szukaj: formatu „Jako [rola] chcę [funkcja], aby [rezultat]" / „As a … I want … so that …", sekcji „User stories", „Historyjki", „Epics", list z „AC:" / „Acceptance criteria".

**To nie jest formalność.** Bez historyjek nie wiadomo, ile ekranów zbudować ani które stany brzegowe pokazać — powstaje ładna makieta CRUD-a, która pomija połowę realnej pracy użytkownika (stany puste, uprawnienia, błędy, przepływy skrótowe). Historyjki są tym, co odróżnia prototyp produktu od prototypu formularza.

### Gdy historyjek NIE MA

Zatrzymaj się i **zapytaj użytkownika**, czy wygenerować mapę historyjek. Nie generuj bez zgody — to istotne rozszerzenie dokumentu wymagań, którego autor może nie chcieć.

Gdy się zgodzi, użyj tego promptu:

> Please add a set of User Stories which are related to this requirements. A real app from crud system distinguish a detaild of user stories coverd, please using best UX knowlage create detailed map of user stories for this module

Wynik ma zawierać:
- **szkielet epików** — etapy podróży użytkownika, nie lista encji
- **historyjki na epik** w formacie „Jako [rola] chcę […], aby […]"
- **kryteria akceptacji** oddające szczegóły UX, nie tylko CRUD (stany puste, optymistyczne UI, cofanie, skróty klawiszowe, uprawnienia, wartości domyślne)
- **zasady przekrojowe** wspólne dla całego modułu

Dopisz mapę do dokumentu wymagań i **pokaż ją do akceptacji przed budową makiet**. Historyjki są kontraktem, na którym opiera się cały prototyp — pomyłka tutaj propaguje się na każdy ekran.

### Gdy historyjki SĄ

Zweryfikuj pokrycie, zanim ruszysz dalej. Jeśli widzisz oczywistą lukę (brak stanów pustych, brak ról, brak ścieżek błędu), **powiedz o tym** i zaproponuj uzupełnienie — ale nie blokuj pracy, jeśli użytkownik chce iść dalej.

---

## Krok 2 — Zbierz inwentarz ekranów

Z historyjek wyprowadź listę ekranów. Każdy ekran musi wskazywać, **które sekcje wymagań i które historyjki pokrywa** — to potem trafia do makiety jako etykiety `.ref`.

Nie pomijaj ekranów, które nie są „głównym przepływem":
- stany puste (pierwsze uruchomienie, brak dostępu, brak wyników)
- warianty ról (co widzi użytkownik bez uprawnień)
- stany błędu i konfliktu
- widoki nakładkowe (drawer, modal) jako osobne ekrany

Pokaż listę użytkownikowi, zanim zaczniesz budować — poprawka na tym etapie jest darmowa.

---

## Krok 3 — Zainicjuj prototyp

```bash
node .ai/skills/om-mockup-prototype/scripts/init-mockup.mjs <nazwa-modułu> \
  --requirements <ścieżka-do-wymagań.md>
```

Tworzy `.ai/mockups/<nazwa-modułu>/` z kompletem plików i wygenerowanym `tokens.css`.

**`tokens.css` jest generowany, nigdy pisany ręcznie.** Powstaje z `apps/mercato/src/app/globals.css` przez `scripts/sync-tokens.mjs`. Ręczne kopiowanie tokenów cicho się rozjeżdża przy każdej zmianie DS — a rozjechany prototyp to prototyp, który kłamie.

Gdy design system się zmienił:
```bash
node .ai/skills/om-mockup-prototype/scripts/sync-tokens.mjs .ai/mockups/<moduł>
node .ai/skills/om-mockup-prototype/scripts/sync-tokens.mjs --check .ai/mockups/<moduł>   # sam audyt
```

---

## Krok 4 — Zbuduj ekrany

Przeczytaj `references/screen-patterns.md` **zanim** napiszesz pierwszą sekcję. Zawiera konkretne struktury powłoki, DataTable, CrudForm i Kanbanu wraz z pułapkami (breadcrumby są w topbarze, tytuł strony jest `font-semibold`, akcje masowe w tabeli są inline).

Każdy ekran to sekcja:

```html
<section class="screen" id="s5">
  <div class="screen-meta">
    <h2>5. Nazwa ekranu</h2>
    <p>Jedno zdanie: co użytkownik tu robi.</p>
    <div class="screen-refs"><span class="ref">§4</span><span class="ref">US-C2</span></div>
  </div>
  <div class="frame">…makieta…</div>
  <div class="notes">
    <div class="note"><b>1</b><span>Zachowanie, którego statyka nie pokaże.</span></div>
  </div>
</section>
```

Zasady:
- `id="sN"` **musi być stabilne** — na nim opierają się kotwice komentarzy. Zmiana id osieroci wątki.
- Sekcja `.notes` jest obowiązkowa tam, gdzie liczy się zachowanie (optymistyczne UI, cofanie, przeliczanie, blokady). Statyczny obrazek tego nie odda, a to zwykle najważniejsza część do przedyskutowania.
- Używaj **realistycznych danych**, nie „Lorem" i nie „Test 1". Fałszywe dane ukrywają problemy z długością tekstu, walutami i wyrównaniem liczb.
- Trzymaj się tokenów DS. Bez `text-red-*`, bez wartości arbitralnych, bez nadpisań `dark:`.

### Tryb klikalny — hotspoty

Element z `data-goto="<id-ekranu>"` staje się klikalny i przenosi na wskazany ekran.

```html
<button class="btn btn-primary" data-goto="s4">Nowy projekt</button>
<a class="nav-item" data-goto="s8">Timesheet</a>
<tr class="clickable" data-goto="s6">…</tr>
```

**Podłącz przynajmniej główną ścieżkę przepływu** — nawigację w sidebarze, akcje główne, wejścia w szczegóły. Prototyp, którego nie da się przeklikać, jest tylko obrazkiem; recenzent nie wyczuje, ile kliknięć kosztuje realne zadanie.

Przycisk „Pokaż klikalne" podświetla wszystkie hotspoty i **przygasza elementy bez przejścia** — dzięki temu od razu widać, co jeszcze nie jest podpięte, zamiast zostawiać recenzenta w niepewności, czy kliknięcie nie zadziałało, bo to prototyp, czy dlatego, że coś jest zepsute.

Tryb „Prezentacja" pokazuje jeden ekran naraz, bez chrome'u dokumentu — do demo na żywo. `←Wstecz` i `Backspace` cofają.

---

## Krok 5 — Zweryfikuj w przeglądarce

**Nie oddawaj prototypu bez obejrzenia go w przeglądarce.** Statyczny HTML łatwo się psuje w sposób niewidoczny w kodzie: nakładające się elementy, przycięte modale, kolizje z-index.

```bash
cd .ai/mockups/<moduł> && python3 -m http.server 8899
```

Sprawdź obowiązkowo:
1. **każdy ekran** w obu motywach (przełącznik w pasku),
2. **ekrany z nakładkami** — modal/drawer mieszczą się w ramce? (użyj `app-tall` / `app-taller`, gdy treść jest przycięta),
3. **tryb klikalny** — hotspoty prowadzą tam, gdzie powinny,
4. **komentarze** — przypnij testowy, przeładuj stronę, sprawdź, czy pinezka wróciła na miejsce.

Po weryfikacji **posprzątaj artefakty** (zrzuty ekranu, `.playwright-mcp/`) — nie zostawiaj ich w repo.

---

## Krok 6 — Przekaż z uczciwym opisem

W odpowiedzi napisz wprost:
- co prototyp **przesądza**, a co zostawia otwarte (miejsca, gdzie wymagania milczą, a Ty musiałeś coś wybrać — oznacz jako propozycję do odrzucenia),
- **sprzeczności w wymaganiach**, które wyszły przy rysowaniu ekranów. To najcenniejszy produkt uboczny prototypowania — rysowanie ujawnia luki, których czytanie nie wychwytuje. Zgłoś je, zamiast po cichu obejść.

---

## Komentarze — jak to działa i co powiedzieć zespołowi

Tryb „Komentarze": kliknięcie dowolnego elementu przypina wątek dokładnie w tym miejscu.

Obieg (**brak współdzielonego backendu — to świadome ograniczenie**):

```
piszesz → localStorage → „Eksportuj do repo" → podmiana comments.js → commit/PR
```

**Zawsze powiedz użytkownikowi wprost, że to nie jest komentowanie na żywo.** Komentarze innej osoby pojawią się dopiero po zmergowaniu jej `comments.js`. Silnik to sygnalizuje (pomarańczowe pinezki, etykieta „lokalny", licznik niewyeksportowanych), ale ograniczenie musi paść też w rozmowie — inaczej ktoś nakomentuje pół dnia w przekonaniu, że zespół to widzi.

Wątki, których kotwica przestała pasować po edycji makiety, trafiają do sekcji „Odklejone wątki" z zachowaną treścią. **Nigdy nie znikają po cichu** — utrata feedbacku recenzenta jest gorsza niż nieaktualna pinezka.

Przy scalaniu dwóch recenzentów: wątki mają unikalne `id`, więc złączenie tablic jest bezpieczne, ale git pokaże konflikt na `comments.js`. Przy 2–3 osobach to sekunda; przy większej grupie zaproponuj przeniesienie dyskusji na issues.

---

## Struktura wygenerowanego prototypu

```
.ai/mockups/<moduł>/
├── index.html       ← ekrany
├── tokens.css       ← GENEROWANY z globals.css (nie edytuj)
├── components.css   ← odpowiedniki prymitywów @open-mercato/ui
├── screens.css      ← powłoka, chrome DataTable, kompozycje bez prymitywu
├── prototype.css    ← warstwa trybu klikalnego i komentarzy
├── prototype.js     ← silnik: hotspoty, prezentacja, komentarze, eksport
├── comments.js      ← zatwierdzone wątki (commitowane)
└── README.md        ← instrukcja dla recenzentów
```

Prototyp otwiera się przez `file://` — `comments.js` to zwykły skrypt, więc do samego przeglądania nie trzeba serwera.

---

## Czego nie robić

- **Nie kopiuj makiety do kodu produkcyjnego.** To czysty HTML/CSS ze sprite'em SVG zamiast `lucide-react` i zaszytymi tekstami zamiast `useT()`. Prototyp odwzorowuje układ, nie implementację.
- **Nie edytuj `tokens.css` ręcznie** — regeneruj skryptem.
- **Nie zmieniaj `id` sekcji** po tym, jak ktoś zaczął komentować.
- **Nie nadpisuj katalogu prototypu** przy ponownym generowaniu — `comments.js` zawiera cudzą pracę.
- **Nie deklaruj funkcji, których makieta nie ma.** Jeśli coś jest tylko obrazkiem, napisz to w `.notes`.
