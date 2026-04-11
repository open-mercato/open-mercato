# Q. Guerrilla Research Plan

> Lekkie metody badawcze: PR archaeology, 5-minute tests, unmoderated tasks, intercept surveys.

---


### Q.1 "5 Questions, 3 People, 15 Minutes"

**Kogo pytać:**
1. Aktywny maintainer modułu (≥10 PR-ów, zna codebase)
2. Okazjonalny contributor (2-5 PR-ów, zna fragmenty)
3. Potencjalny contributor (śledzi repo, może otworzył 1 issue, jeszcze nie commitował)

**Jak przeprowadzić: Async survey via GitHub Discussion.**

Uzasadnienie: Synchroniczny call wymaga koordynacji timezone i zniechęca introwertycznych contributorów. Discussion post z pytaniami pozwala odpowiedzieć gdy ktoś ma 10 minut. Dodatkowo: odpowiedzi są publiczne, co buduje precedens otwartej komunikacji o DS.

**5 pytań:**

1. **"Gdy ostatnio budowałeś nowy ekran (lub modyfikowałeś istniejący) — skąd wiedziałeś jakich komponentów użyć? Co otworzyłeś najpierw?"**
   Cel: Odkryć discovery path. Czy grepują? Kopiują z innego modułu? Pytają kogoś?

2. **"Czy zdarzyło ci się, że reviewer poprosił o zmianę koloru, spacingu lub komponentu w twoim PR? Jeśli tak — czy wiedziałeś dlaczego ta zmiana była potrzebna?"**
   Cel: Zmierzyć review friction i zrozumieć czy contributor rozumie reguły czy wykonuje polecenia.

3. **"Gdybyś jutro miał zbudować stronę listy z tabelą, statusami i pustym stanem — od czego byś zaczął? Który moduł otworzyłbyś jako wzorzec?"**
   Cel: Odkryć który moduł jest de facto referencyjny (może nie customers!) i jakie jest mentalne model contributora.

4. **"Co jest najbardziej irytujące w budowaniu UI w Open Mercato? Jedna konkretna rzecz."**
   Cel: Odkryć friction point którego nie widać w code audit. Może to jest brak hot reload, może wolny build, może niejasna nawigacja w kodzie.

5. **"Gdybyś mógł zmienić jedną rzecz w tym jak wygląda lub działa Open Mercato UI — co by to było?"**
   Cel: Walidacja priorytetów. Jeśli 3/3 osób mówi "dark mode jest popsute" — wiemy że semantic tokens to prawidłowy priorytet. Jeśli mówią "brak mobile view" — wiemy że nasze priorytety mogą wymagać korekty.

**Template na summary wyników (1 strona):**

```markdown
## DS Research Summary — [data]

### Participants
- [persona 1]: [moduł/rola], [ile PR-ów]
- [persona 2]: ...
- [persona 3]: ...

### Key Findings
1. **Discovery path:** [jak szukają komponentów — np. "2/3 kopiuje z customers"]
2. **Review friction:** [ile rund, czy rozumieją reguły — np. "nikt nie wiedział o semantic tokens"]
3. **Reference module:** [który moduł uważają za wzorcowy]
4. **Top friction point:** [co ich najbardziej irytuje]
5. **Top wish:** [co by zmienili]

### Impact on DS Plan
- [Co potwierdzamy — np. "semantic tokens to prawidłowy priorytet #1"]
- [Co zmieniamy — np. "dodajemy hot reload do hackathon scope bo 2/3 osób narzeka"]
- [Co dodajemy — np. "trzeba udokumentować dlaczego customers a nie sales jest referencyjny"]
```

### Q.2 Hallway Testing — komponentów API

**Task dla contributora (dosłowny tekst):**

> Mam TypeScript interface nowego komponentu FormField. Bez patrzenia na dokumentację — napisz mi JSX który wyświetla formularz z 3 polami: Name (text, required), Email (text, z opisem "We'll never share your email"), Status (select, z errorem "Status is required"). Możesz użyć dowolnych komponentów wewnątrz FormField. Masz 3 minuty.

```typescript
// To dajesz contributorowi:
interface FormFieldProps {
  label?: string
  id?: string
  required?: boolean
  labelVariant?: 'default' | 'overline'
  description?: string
  error?: string
  orientation?: 'vertical' | 'horizontal'
  disabled?: boolean
  children: React.ReactNode
}
```

**Co obserwujesz (rubric):**

| Aspekt | Sukces (5 pkt) | Problemy (3 pkt) | Porażka (1 pkt) |
|--------|----------------|-------------------|-----------------|
| **Zrozumienie children pattern** | Od razu wstawia `<Input>` jako children | Pyta "czy to slot?" ale rozumie po chwili | Próbuje przekazać input jako prop |
| **Required indicator** | Używa `required={true}` i oczekuje że label się zmieni | Dodaje ręczny asterisk w label | Nie wie jak oznaczyć pole jako required |
| **Error handling** | Przekazuje `error="..."` i nie dodaje ręcznego error display | Pyta "czy error wyświetla się automatycznie?" | Dodaje ręczny `<span className="text-red-600">` pod polem |
| **Naming intuition** | Nie pyta o żaden prop name | Pyta o 1 prop name | Pyta o ≥3 prop names |
| **Czas** | <2 min | 2-3 min | >3 min lub nie kończy |

**Jeśli contributor ≤3 na "children pattern":** Rozważamy zmianę API na `input` prop zamiast `children`. Jeśli ≥4 na wszystkich: API jest intuicyjne.

### Q.3 Observation Protocol — "Watch One, Do One"

**Kiedy: PO hackathonie** (tydzień 2). Uzasadnienie: Chcemy walidować czy DS artefakty (templates, tokens, lint rules) działają w praktyce, nie w teorii.

**Setup:**

> "Wyobraź sobie, że Sales module potrzebuje nowej strony: lista warranties (gwarancji) z tabelą, statusami (active/expired/pending), pustym stanem i możliwością tworzenia nowej gwarancji. Zbuduj stronę listy. Masz 30 minut. Możesz używać dowolnych plików w repo. Powiedz mi na głos co robisz — np. 'otwieram customers żeby zobaczyć wzorzec'. Nie pytaj mnie o pomoc — rób jak byś robił sam."

**Obserwacja — co notujesz:**

| Czas | Notujesz |
|------|----------|
| 0:00-2:00 | **Gdzie szuka:** Otwiera DS.md? Customers module? Grepuje? Googluje? |
| 2:00-5:00 | **Co kopiuje:** Który template/moduł? Czy używa K.1? |
| 5:00-15:00 | **Gdzie utyka:** Import paths? Token names? StatusBadge API? EmptyState props? |
| 15:00-25:00 | **Co omija:** Czy dodaje EmptyState? Loading state? useT()? metadata? |
| 25:00-30:00 | **Czy lint pomógł:** Czy uruchamia lint? Czy lint wyłapał problemy? |

**Zasada obserwacji:** Nie pomagasz, nie komentujesz, nie kiwasz głową aprobująco. Notujesz. Jedyny wyjątek: jeśli contributor jest zablokowany >3 min na tym samym miejscu, możesz powiedzieć "kontynuuj dalej, wrócimy do tego".

**Debrief (3 pytania):**

1. "Co było najłatwiejsze w budowaniu tej strony?"
2. "Gdzie się zatrzymałeś najdłużej — i dlaczego?"
3. "Gdybyś mógł zmienić jedno narzędzie/plik/komponent żeby to było szybsze — co by to było?"


---

## See also

- [Success Metrics Beyond Code](./success-metrics-cx.md) — metryki informowane przez research
- [Iteration](./iteration.md) — cykl feedback oparty o wyniki badań
- [Champions](./champions.md) — champions jako źródło insightów
