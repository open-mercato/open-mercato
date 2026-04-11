# M. Contributor Onboarding — "Your First Module" Guide

> Krok po kroku: od sklonowania repo do merge. Zawiera FAQ i mental model DS.

---

### M.1 Before-You-Start Checklist

Zanim napiszesz pierwszą linijkę kodu nowego modułu, sprawdź:

- [ ] **Przeczytałem AGENTS.md** — Task Router wskazuje na właściwe guide'y
- [ ] **Przeczytałem `packages/core/AGENTS.md`** — auto-discovery, module files, konwencje
- [ ] **Przeczytałem `packages/core/src/modules/customers/AGENTS.md`** — referencyjny moduł CRUD
- [ ] **Przeczytałem `packages/ui/AGENTS.md`** — komponenty UI, DataTable, CrudForm
- [ ] **Sprawdziłem `.ai/specs/`** — czy istnieje spec dla mojego modułu
- [ ] **Mam zainstalowane narzędzia**: `yarn`, Node ≥20, Docker (dla DB)
- [ ] **Zbudowałem projekt**: `yarn initialize` przeszło bez błędów
- [ ] **Uruchomiłem dev**: `yarn dev` działa, widzę dashboard w przeglądarce

### M.2 Step-by-Step: Tworzenie modułu

**Krok 1 — Scaffold**
```bash
# Opcja A: scaffold script (z sekcji K.3)
./ds-scaffold-module.sh invoices invoice

# Opcja B: ręcznie — skopiuj strukturę z customers i wyczyść
```

**Krok 2 — Zdefiniuj encję**
```
data/entities.ts → MikroORM entity z id, organization_id, timestamps
data/validators.ts → Zod schema per endpoint
```
Wzór: `packages/core/src/modules/customers/data/entities.ts`

**Krok 3 — Dodaj CRUD API**
```
api/<module>/route.ts → makeCrudRoute + openApi export
```
Wzór: `packages/core/src/modules/customers/api/companies/route.ts`

**Krok 4 — Stwórz strony backend**
```
backend/<module>/page.tsx       → List (template K.1.1)
backend/<module>/create/page.tsx → Create (template K.1.2)
backend/<module>/[id]/page.tsx   → Detail (template K.1.3)
```
**WAŻNE**: Każdy template wymaga — `Page`+`PageBody`, `useT()`, `EmptyState`, `LoadingMessage`/`isLoading`, `StatusBadge` dla statusów.

**Krok 5 — ACL + Setup**
```
acl.ts   → features: view, create, update, delete
setup.ts → defaultRoleFeatures (admin = all, user = view)
```

**Krok 6 — i18n**
```
i18n/en.json → wszystkie user-facing strings
i18n/pl.json → tłumaczenia (jeśli dotyczy)
```

**Krok 7 — Rejestracja**
```
apps/mercato/src/modules.ts → dodaj moduł
yarn generate && yarn db:generate && yarn db:migrate
```

**Krok 8 — Weryfikacja**
```bash
yarn lint                 # 0 errors, 0 warnings
yarn build:packages       # builds clean
yarn test                 # existing tests pass
yarn dev                  # nowy moduł widoczny w sidebar
```

### M.3 Self-Check: 10 pytań przed PR

Odpowiedz TAK na każde pytanie zanim otworzysz Pull Request:

| # | Pytanie | Dotyczy |
|---|---------|---------|
| 1 | Czy **każda** strona listy ma `<EmptyState>` z akcją tworzenia? | UX |
| 2 | Czy strony detail/edit mają `<LoadingMessage>` i `<ErrorMessage>`? | UX |
| 3 | Czy **wszystkie** user-facing strings używają `useT()` / `resolveTranslations()`? | i18n |
| 4 | Czy statusy renderowane są przez `<StatusBadge>` (nie surowy tekst/span)? | Design System |
| 5 | Czy kolory statusów używają semantic tokens (`text-destructive`, `bg-status-*-bg`)? | Design System |
| 6 | Czy formularze używają `<CrudForm>` (nie ręczne `<form>`)? | Spójność |
| 7 | Czy API routes mają `openApi` export? | Dokumentacja |
| 8 | Czy strony mają `metadata` z `requireAuth` i `requireFeatures`? | Bezpieczeństwo |
| 9 | Czy `setup.ts` deklaruje `defaultRoleFeatures` dla features z `acl.ts`? | RBAC |
| 10 | Czy `yarn lint && yarn build:packages` przechodzi bez błędów? | CI |

### M.4 Top 5 Anti-Patterns

| # | Anti-pattern | Dlaczego źle | Co zamiast |
|---|-------------|--------------|------------|
| 1 | **Hardcoded strings** `<h1>My Module</h1>` | Łamie i18n, blokuje tłumaczenia | `<h1>{t('module.title', 'My Module')}</h1>` |
| 2 | **Pusta tabela zamiast EmptyState** — DataTable z 0 rows bez żadnego CTA | Użytkownik nie wie co robić, bounce rate ↑ | Warunkowy `<EmptyState>` z akcją tworzenia gdy `rows.length === 0 && !search` |
| 3 | **Raw `fetch()`** zamiast `apiCall()` | Brak obsługi auth, cache, error handling | `apiCall('/api/...')` z `@open-mercato/ui/backend/utils/apiCall` |
| 4 | **Tailwind color classes** `text-red-600`, `bg-green-100` dla statusów | Niespójne z dark mode, brak central governance | Semantic tokens: `text-destructive`, `bg-status-success-bg` |
| 5 | **Brak `metadata` z RBAC** — strona bez `requireAuth` / `requireFeatures` | Każdy zalogowany widzi stronę, nawet bez uprawnień | Dodaj `metadata.requireFeatures: ['module.view']` |

---

---

## See also

- [Contributor Guardrails](./contributor-guardrails.md) — szablony stron i scaffold script
- [Lint Rules](./lint-rules.md) — reguły które CI sprawdzi na PR
- [Principles](./principles.md) — zasady projektowe do zapamiętania
- [Contributor Experience](./contributor-experience.md) — szersze podejście do DX
