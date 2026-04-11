# Część 2 — Design Principles

> 8 zasad projektowych Open Mercato + PR review checklist.

---

## Propozycja Design Principles dla Open Mercato

### Principle 1: Clarity Over Cleverness

**Definicja:** Kazdy element interfejsu powinien byc oczywisty w swoim przeznaczeniu. Zero magii, zero ukrytych zachowan.

**Rozwiniecie:** W projekcie open source contributorzy maja rozny poziom doswiadczenia. Interface musi byc zrozumialy zarowno dla uzytkownika koncowego, jak i dla developera czytajacego kod. Jesli trzeba tlumaczyc, co robi komponent — jest zbyt skomplikowany.

**Dlaczego wazny w OSS:** Nowi contributorzy musza zrozumiec UI patterns bez mentoringu. Klarowne wzorce redukuja onboarding time.

**Jakie decyzje wspiera:**
- Explicit props over magic defaults
- Descriptive naming over abbreviations
- Visible state over hidden state
- Documentation of "why" not just "how"

**Dobry przyklad:** `<EmptyState title="No customers yet" description="Create your first customer" action={{ label: "Add customer", onClick: handleCreate }} />` — kzde zachowanie widoczne w props.

**Naruszenie:** Komponent ktory zmienia swoje zachowanie w zaleznosci od kontekstu parent, bez widocznego prop.

**Wplyw na contributora:** Moze budowac UI bez studiowania internals.
**Wplyw na UX:** Uzytkownik zawsze wie, co sie dzieje i dlaczego.
**Wplyw na spojnosc:** Explicit patterns sa latwiejsze do replikowania.

---

### Principle 2: Consistency Is a Feature

**Definicja:** Te same problemy rozwiazujemy w ten sam sposob. Zawsze.

**Rozwiniecie:** Spojnosc nie jest ograniczeniem — jest produktem. Uzytkownik ucze sie wzorcow raz i stosuje je wszedzie. Contributor buduje nowy modul szybciej, bo wzorce sa znane.

**Dlaczego wazny w OSS:** 34 moduly, wielu contributorow. Bez consistency kazdy modul wyglada jak oddzielna aplikacja.

**Jakie decyzje wspiera:**
- Uzyj istniejacego komponentu zamiast tworzenia nowego
- Stosuj te same spacing, colors, typography tokens
- Ten sam CRUD flow w kazdym module
- Ten sam error/success pattern wszedzie

**Dobry przyklad:** Kazda lista uzytkownikow, produktow, zamowien wyglada i dziala identycznie — DataTable z tymi samymi filtrami, akcjami, paginacja.

**Naruszenie:** Portal signup page z recznie zbudowanym formularzem o innym spacing i labelach niz reszta systemu.

**Wplyw na contributora:** Mniej decyzji = szybsze budowanie.
**Wplyw na UX:** Uzytkownik czuje sie "jak w domu" w kazdym module.
**Wplyw na spojnosc:** Eliminuje design debt zanim powstanie.

---

### Principle 3: Accessible by Default

**Definicja:** Accessibility nie jest dodatkiem ani checklist item. Jest wbudowana w kazdy komponent od poczatku.

**Rozwiniecie:** Komponent bez aria-label nie jest "prawie gotowy" — jest niekompletny. DS musi gwarantowac, ze uzywajac komponentow z systemu, contributor automatycznie dostarcza accessible UI.

**Dlaczego wazny w OSS:** Roznorodni contributorzy maja rozna swiadomosc a11y. System musi wymusic dobre praktyki.

**Jakie decyzje wspiera:**
- Wymagane `aria-label` na IconButton (enforced przez TypeScript)
- Semantic HTML jako default (nie `<div>` z onClick)
- Focus management w kazdym komponencie interaktywnym
- Color contrast sprawdzany na poziomie tokenow
- Keyboard navigation jako czesc definicji "done"

**Dobry przyklad:** `<IconButton aria-label="Delete customer">` — TypeScript error jesli brak aria-label.

**Naruszenie:** 370+ interactive elements bez aria-label w obecnym codebase.

**Wplyw na contributora:** Nie musi pamietac o a11y — system wymusza.
**Wplyw na UX:** Produkt jest uzywalny dla wszystkich.
**Wplyw na spojnosc:** Accessibility rules sa czescia design system contract.

---

### Principle 4: Reuse Over Reinvention

**Definicja:** Nie buduj tego, co juz istnieje. Rozszerzaj istniejace komponenty zamiast tworzenia nowych.

**Rozwiniecie:** Kazdy nowy komponent to koszt utrzymania. W OSS ten koszt jest rozlozony na wielu maintainerow. Im mniej komponentow, tym latwiej je utrzymac, testowac, dokumentowac.

**Dlaczego wazny w OSS:** Duplikacja to naturalny efekt decentralized contribution. 15+ Section components w Open Mercato to dowod.

**Jakie decyzje wspiera:**
- Sprawdz istniejace komponenty przed budowaniem nowego
- Uzywaj composition (children, slots) zamiast tworzenia wariantow
- Jeden komponent Alert zamiast Notice + Alert + ErrorNotice
- Jeden sposob wyswietlania statusow zamiast hardcoded kolorow per modul

**Dobry przyklad:** Uzycie `<DataTable>` z customizacja zamiast budowania wlasnej listy.

**Naruszenie:** `Notice` i `Alert` — dwa komponenty robiace to samo z roznymi API i kolorami.

**Wplyw na contributora:** Mniej do nauki, mniej do utrzymania.
**Wplyw na UX:** Spojne zachowanie feedbacku.
**Wplyw na spojnosc:** Redukcja surface area systemu.

---

### Principle 5: Predictable Behavior

**Definicja:** Uzytkownik powinien moc przewidziec zachowanie UI zanim kliknie. Zadnych niespodzianek.

**Rozwiniecie:** Jesli przycisk "Delete" w jednym module pokazuje dialog potwierdzenia, musi to robic w kazdym module. Jesli `Escape` zamyka formularz, musi zamykac kazdy formularz.

**Dlaczego wazny w OSS:** Rozni contributorzy moga inaczej implementowac ten sam pattern. System musi gwarantowac spojne zachowanie.

**Jakie decyzje wspiera:**
- Destructive actions zawsze wymagaja potwierdzenia
- Keyboard shortcuts sa globalne i spojne
- Loading states zawsze sa widoczne
- Error messages zawsze pojawiaja sie w tym samym miejscu

**Dobry przyklad:** `Cmd/Ctrl+Enter` submit w kazdym formularzu, `Escape` cancel — ujednolicone przez CrudForm.

**Naruszenie:** Formularz auth login ktory nie obsluguje `Escape` do anulowania.

**Wplyw na contributora:** Jasne reguły = mniej edge case'ow do obslugi.
**Wplyw na UX:** Uzytkownik buduje muscle memory.
**Wplyw na spojnosc:** Zachowania sa czescia systemu, nie czescia modulu.

---

### Principle 6: System Thinking

**Definicja:** Kazdy komponent jest czescia wiekszego systemu. Nie projektuj w izolacji.

**Rozwiniecie:** Zmiana koloru buttona wplywa na kontrast z tlem, czytelnosc tekstu, dark mode, alert states. Zmiana spacing jednego komponentu wplywa na layout calej strony. Mysl o zaleznosach.

**Dlaczego wazny w OSS:** Contributor widzi swoj PR, nie widzi calego systemu. Design system musi wymuszac myslenie systemowe.

**Jakie decyzje wspiera:**
- Uzywaj tokenow zamiast hardcoded wartosci
- Testuj zmiany w kontekscie calej strony, nie tylko komponentu
- Rozumiej zaleznosci miedzy komponentami
- Dokumentuj side effects zmian

**Dobry przyklad:** Zmiana `--destructive` color token automatycznie aktualizuje wszystkie error states w systemie.

**Naruszenie:** 372 hardcoded kolorow — zmiana semantyki "error" wymaga edycji 159 plikow.

**Wplyw na contributora:** Zmiana w jednym miejscu propaguje sie prawidlowo.
**Wplyw na UX:** Spojny system bez "dziur".
**Wplyw na spojnosc:** System jest self-reinforcing.

---

### Principle 7: Progressive Disclosure

**Definicja:** Pokazuj tylko to, co jest potrzebne teraz. Reszta dostepna na zadanie.

**Rozwiniecie:** Formularz z 30 polami przytlacza. Tabela z 20 kolumnami jest nieczytelna. Pokazuj minimum, pozwol uzytkownikowi odslaniac wiecej gdy potrzebuje.

**Dlaczego wazny w OSS:** Nowi contributorzy dodaja pola "na wszelki wypadek". System musi zachecac do minimalizmu.

**Jakie decyzje wspiera:**
- Default column set w DataTable (5-7 kolumn), reszta w column chooser
- Grouped form fields z collapsible sections
- Summary view → detail view pattern
- Advanced filters ukryte za "More filters" trigger

**Dobry przyklad:** DataTable z column chooser — domyslnie 5 kolumn, uzytkownik dodaje kolejne.

**Naruszenie:** Formularz z 20 widocznymi polami bez grupowania.

**Wplyw na contributora:** Jasne guidelines ile pol/kolumn jest "za duzo".
**Wplyw na UX:** Mniejsze cognitive load.
**Wplyw na spojnosc:** Wszystkie listy i formularze maja podobna gestosc informacji.

---

### Principle 8: Contribution-Friendly Design

**Definicja:** Design system musi byc latwy do uzycia, trudny do zlamania.

**Rozwiniecie:** Contributor powinien moc zbudowac spojny ekran uzywajac 5-10 komponentow, bez czytania 100 stron dokumentacji. TypeScript powinien lapac bledy zanim trafi do PR review.

**Dlaczego wazny w OSS:** Design system dla zamknietego zespolu moze polegac na tribal knowledge. OSS musi byc self-documenting.

**Jakie decyzje wspiera:**
- Proste API komponentow (malo wymaganych props, sensowne defaults)
- TypeScript enforcement (required aria-label, required variant)
- Komponent-templates zamiast budowania od zera
- Dobre error messages w dev mode
- Przyklad referencyjny (customers module)

**Dobry przyklad:** `<CrudForm fields={[...]} onSubmit={fn} />` — contributor podaje pola i submit handler, reszta jest automatyczna.

**Naruszenie:** Komponent z 25 props, z czego 15 jest wymaganych.

**Wplyw na contributora:** Szybki start, trudno o blad.
**Wplyw na UX:** Kazdy contributor dostarcza podobnej jakosci UI.
**Wplyw na spojnosc:** System wymusza dobre praktyki zamiast na nie polegac.

---

## Skrocona wersja principles (do README)

```
## Design Principles

1. **Clarity Over Cleverness** — Every UI element should be obvious in purpose
2. **Consistency Is a Feature** — Same problems, same solutions, always
3. **Accessible by Default** — A11y is built-in, not bolted-on
4. **Reuse Over Reinvention** — Extend existing components, don't create new ones
5. **Predictable Behavior** — Users should predict UI behavior before clicking
6. **System Thinking** — Every component is part of a larger system
7. **Progressive Disclosure** — Show what's needed now, reveal more on demand
8. **Contribution-Friendly** — Easy to use correctly, hard to use wrong
```

## Design Review / PR Review Checklist (based on principles)

### Clarity
- [ ] Czy komponent ma oczywiste przeznaczenie bez czytania dokumentacji?
- [ ] Czy prop names sa opisowe i jednoznaczne?
- [ ] Czy stany (loading, error, empty) sa jawnie obslugiwane?

### Consistency
- [ ] Czy uzyto istniejacych tokenow (colors, spacing, typography)?
- [ ] Czy CRUD flow jest identyczny z innymi modulami?
- [ ] Czy error/success feedback uzywa tych samych komponentow?
- [ ] Czy spacing jest zgodny ze skala systemu?

### Accessibility
- [ ] Czy kazdy interactive element ma aria-label lub visible label?
- [ ] Czy uzytko semantic HTML (button, nav, heading)?
- [ ] Czy komponent jest nawigowany klawiatura?
- [ ] Czy contrast ratio jest wystarczajacy?

### Reuse
- [ ] Czy sprawdzono istniejace komponenty przed budowaniem nowego?
- [ ] Czy nie zduplikowano logiki innego komponentu?
- [ ] Czy uzyto composition zamiast nowego wariantu?

### Predictability
- [ ] Czy destructive actions maja dialog potwierdzenia?
- [ ] Czy keyboard shortcuts sa spojne z reszta systemu?
- [ ] Czy uzytkownik wie, co sie stanie po kliknieciu?

### System Thinking
- [ ] Czy uzyto design tokenow zamiast hardcoded wartosci?
- [ ] Czy zmiana dziala poprawnie w dark mode?
- [ ] Czy komponent dziala poprawnie w roznych kontekstach (modal, page, sidebar)?

### Progressive Disclosure
- [ ] Czy formularz nie ma wiecej niz 7-10 widocznych pol?
- [ ] Czy tabela nie ma wiecej niz 7 domyslnych kolumn?
- [ ] Czy zaawansowane opcje sa ukryte za triggerem?

### Contribution-Friendly
- [ ] Czy nowy contributor moze uzyc komponentu bez mentoringu?
- [ ] Czy TypeScript lapi typowe bledy?
- [ ] Czy istnieje przyklad uzycia (w customers module lub Storybook)?

---

---

## See also

- [Audit](./audit.md) — dane audytu na których oparto principles
- [Foundations](./foundations.md) — implementacja tokenów i skal
- [Enforcement](./enforcement.md) — egzekucja zasad w CI/PR
- [Contributor Guardrails](./contributor-guardrails.md) — szablony modułów
