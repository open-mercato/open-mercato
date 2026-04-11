# B. Plan na Hackathon

> Szczegółowy plan hackathonu (PT 9:00 – SO 11:00) z blokami czasowymi i deliverables.

---

**Czas trwania:** 11 kwietnia 2026 (piatek) 9:00 – 12 kwietnia 2026 (sobota) 11:00
**Budzet czasu:** ~18h roboczych (26h kalendarzowych minus sen/przerwy)
**Strategia:** Foundations first, potem komponenty, na koniec dokumentacja. Kazdy blok konczy sie commitem.

---

## BLOK 1 — Piątek 9:00–12:00 (3h): Foundations + Tokens

**Cel: działające semantic color tokens w Tailwind + documentation foundations**

- [ ] Dodać 20 CSS custom properties do `globals.css` (light mode)
- [ ] Dodać 20 CSS custom properties do `.dark` (dark mode)
- [ ] Dodać `text-overline` token (11px)
- [ ] Dodać `@theme inline` mappings dla Tailwind v4
- [ ] Zweryfikować contrast w Chrome DevTools (light + dark) — wszystkie 5 statusów
- [ ] Udokumentować typography scale (tabela)
- [ ] Udokumentować spacing guidelines (usage rules)
- [ ] `yarn lint && yarn typecheck` — upewnić się, że nic nie zepsute
→ **Commit:** `feat(ds): add semantic status tokens, text-overline, and foundation docs`

## BLOK 2 — Piątek 13:00–17:00 (4h): Migracja primitives

**Cel: wszystkie primitives używają semantic tokenów**

- [ ] Zamienić Alert CVA variants na flat semantic tokens (`alert.tsx` — 4 linie)
- [ ] Zamienić Notice colors na semantic tokens + deprecation warning (`Notice.tsx`)
- [ ] Zamienić FlashMessages colors (`FlashMessages.tsx`)
- [ ] Zamienić Notification severity colors
- [ ] Dodać status warianty do Badge (`badge.tsx` — success, warning, info)
- [ ] Zmigrować CrudForm FieldControl colors (`text-red-600` → `text-destructive`)
- [ ] `yarn lint && yarn typecheck && yarn test`
→ **Commit:** `refactor(ds): migrate all primitives to semantic status tokens`

## BLOK 3 — Piątek 18:00–20:00 (2h): Nowe komponenty

**Cel: FormField + StatusBadge gotowe (Section jako stretch goal)**

- [ ] Stworzyć `FormField` wrapper (`packages/ui/src/primitives/form-field.tsx`)
- [ ] Stworzyć `StatusBadge` (`packages/ui/src/primitives/status-badge.tsx`)
- [ ] Jeśli czas pozwala: `Section` / `SectionHeader` (`packages/ui/src/backend/Section.tsx`)
- [ ] `yarn lint && yarn typecheck`
→ **Commit:** `feat(ds): add FormField, StatusBadge components`

## Piątek 20:00–21:00: PRZERWA / BUFOR

Odpoczynek. Jeśli Blok 3 się przeciągnął — dokończ go teraz. Nie zaczynaj nowej pracy.

## BLOK 4 — Piątek 21:00–22:00 (1h): Dokumentacja (lekka praca)

**Cel: principles i checklist gotowe (niskoryzykowa praca na koniec dnia)**

- [ ] Napisać Design Principles — skrócona wersja do README
- [ ] Napisać PR Review Checklist (checkboxy DS compliance)
- [ ] Zdefiniować z-index scale + border-radius usage guidelines
→ **Commit:** `docs(ds): add principles, PR review checklist, foundation guidelines`

## BLOK 5 — Sobota 8:00–10:00 (2h): Migracja customers module

**Cel: proof of concept — jeden moduł w pełni zmigrowany (świeża głowa)**

- [ ] Uruchomić `ds-migrate-colors.sh` na `packages/core/src/modules/customers/`
- [ ] Uruchomić `ds-migrate-typography.sh` na tym samym module
- [ ] Manual review + fix edge cases
- [ ] Screenshot before/after (light + dark)
- [ ] `yarn lint && yarn typecheck && yarn test`
→ **Commit:** `refactor(ds): migrate customers module to DS tokens`

## BLOK 6 — Sobota 10:00–11:00 (1h): Wrap-up

**Cel: system gotowy do adopcji**

- [ ] Zaktualizować AGENTS.md z DS rules
- [ ] Zaktualizować PR template z DS compliance checkboxami
- [ ] Uruchomić `ds-health-check.sh` — zapisać baseline
- [ ] Final `yarn lint && yarn typecheck` pass
→ **Commit:** `docs(ds): update AGENTS.md, PR template, baseline report`

---

**Bufor:** Plan pokrywa ~13h. Zostaje ~5h buforu na:
- Edge case'y w migracji customers
- Debugging dark mode contrast
- Section component (jeśli nie zmieścił się w Bloku 3)
- Niespodzianki w CrudForm FieldControl

---

## B.1 Cut Lines — co jeśli nie zdążymy

### MUST HAVE — 8h minimum (Bloki 1 + 2)

**Definicja sukcesu:** Semantic color tokens istnieją i są używane przez istniejące komponenty. Nowe PR-y mogą korzystać z tokenów. Dark mode działa.

Commity:
1. `feat(ds): add semantic status tokens, text-overline, and foundation docs`
2. `refactor(ds): migrate all primitives to semantic status tokens`

**Co to daje:**
- 20 semantic tokens w globals.css (light + dark)
- Alert, Notice, Badge, FlashMessages, Notifications — wszystkie na tokenach
- CrudForm FieldControl — error colors na tokenach
- Typography scale i spacing guidelines udokumentowane
- Foundation na której buduje się reszta

**Jeśli nic więcej nie zdążymy** — hackathon jest sukcesem. Mamy system tokenów, który eliminuje 80% problemu kolorystycznego. Każdy nowy PR od teraz może używać `text-status-error-text` zamiast `text-red-600`.

### SHOULD HAVE — 14h (+ Bloki 3, 4)

**Commity dodatkowe:**
3. `feat(ds): add FormField, StatusBadge components`
4. `docs(ds): add principles, PR review checklist, foundation guidelines`

**Co to dodaje:**
- Nowe komponenty do użycia od zaraz
- Principles i PR checklist — enforcement dla contributorów
- Z-index scale i border-radius guidelines

### NICE TO HAVE — 18h (+ Bloki 5, 6)

**Commity dodatkowe:**
5. `refactor(ds): migrate customers module to DS tokens`
6. `docs(ds): update AGENTS.md, PR template, baseline report`

**Co to dodaje:**
- Proof of concept: cały moduł zmigrowany
- AGENTS.md rules — AI agents generują DS-compliant kod
- Baseline health report do trackowania postępu
- Section component (jeśli zmieścił się w buforze)

---

## See also

- [Executive Summary](./executive-summary.md) — podsumowanie strategiczne
- [Deliverables](./deliverables.md) — lista oczekiwanych wyników
- [Enforcement](./enforcement.md) — plan egzekucji po hackathonie
