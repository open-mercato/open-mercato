# Audyt migracji MikroORM v6 → v7 dla Open Mercato

Dokument opisuje stan migracji z MikroORM v6 do v7 na gałęzi `upgrade-mikro-orm` i plan dokończenia prac. Oparty na oficjalnych breaking changes ([mikro-orm.io/docs/upgrading-v6-to-v7](https://mikro-orm.io/docs/upgrading-v6-to-v7)) oraz rzeczywistym stanie zainstalowanej wersji `@mikro-orm/*@7.0.10` w repo.

## Stan aktualny

**Już zrobione** (commity na gałęzi `upgrade-mikro-orm`):

- Wersje `@mikro-orm/*` podbite do `^7.0.10` we wszystkich workspace'ach (`package.json`, `packages/*/package.json`)
- `@mikro-orm/decorators` dodany jako osobny pakiet, migracja importów na `@mikro-orm/decorators/legacy` (commit `86f1f5874`)
- Użycia `getSchemaGenerator()`/`getMigrator()` zaktualizowane do `orm.schema.*`/`orm.migrator.*` (commit `4b7290f48`) — 0 pozostałości
- Brak użyć `MikroORM.initSync`, `getKnexQuery`, importów `@mikro-orm/knex` (0 pozostałości)
- Zmiany w konfiguracji SSL (commit `e52886214`)
- Bootstrap ORM w `packages/shared/src/lib/db/mikro.ts` używa `MikroORM.init({ driver: PostgreSqlDriver, ... })`
- Node 24.x zadeklarowany w `package.json#engines`
- `moduleResolution: "bundler"` w `tsconfig.base.json`

## Co jeszcze blokuje build (`tsc --noEmit`)

| Pakiet | Błędów | Główne przyczyny |
|---|---|---|
| `@open-mercato/core` | 105 | knex, persistAndFlush, FilterQuery |
| `@open-mercato/search` | 55 | knex import + getKnex |
| `@open-mercato/onboarding` | 49 | cascade from shared types |
| `@open-mercato/enterprise` | 34 | getKnex |
| `@open-mercato/shared` | 33 | **źródłowe — naprawić pierwsze** |
| `@open-mercato/checkout` | 33 | cascade |
| `@open-mercato/cli` | 29 | bootstrap/connect |
| `@open-mercato/webhooks` | 29 | cascade |
| `@open-mercato/events` | 26 | cascade z shared |
| `@open-mercato/scheduler` | 26 | cascade z shared |
| `@open-mercato/gateway-stripe` | 26 | cascade z shared |
| `@open-mercato/sync-akeneo` | 26 | cascade z shared |

Razem: **~471 błędów typów**, większość kaskadowo ze `shared/src/lib/data/engine.ts`, `shared/src/lib/query/engine.ts`, `shared/src/lib/db/mikro.ts`.

Pakiety bez błędów: `ui`, `queue`, `cache` (nie używają bezpośrednio ORM).

## Kategorie prac

### 1. Usunięte metody EM: `persistAndFlush` / `removeAndFlush`

Potwierdzone w zainstalowanym `node_modules/@mikro-orm/core/EntityManager.d.ts` — metod **nie ma**.

- **125 wywołań `persistAndFlush`** w **45 plikach** (produkcja + testy)
- **15 wywołań `removeAndFlush`** w **10 plikach**

Wymagana zamiana wszędzie:

```ts
// przed
await em.persistAndFlush(entity);
await em.removeAndFlush(entity);

// po
await em.persist(entity).flush();
await em.remove(entity).flush();
```

Dotkniętych m.in.: `shared/src/lib/data/engine.ts`, commandy (customers, messages, workflows, auth, api_keys, business_rules), testy (45 plików z testami używają tego API — muszą zostać zaktualizowane), przykłady w `apps/mercato/src/modules/example`, templatki w `packages/create-app/template`.

### 2. Knex → Kysely — **największa praca** (~150+ callsite'ów)

v7 usunął warstwę knex; zamiast tego `SqlEntityManager.getKysely()`. Potwierdzone w `node_modules/@mikro-orm/postgresql/PostgreSqlConnection.d.ts`:

```ts
export declare class PostgreSqlConnection extends AbstractSqlConnection {
  createKyselyDialect(overrides: PoolConfig): PostgresDialect;
  mapOptions(overrides: PoolConfig): PoolConfig;
}
```

Następujące wzorce są zepsute:

- `em.getKnex()` — metoda nie istnieje
- `em.getConnection().getKnex()` — `PostgreSqlConnection` nie ma `getKnex`
- `import type { Knex } from 'knex'` — pakiet nie jest już tranzytywnie dostępny

Przykładowe krytyczne pliki wymagające pełnego przepisania:

- `packages/shared/src/lib/data/engine.ts` (rdzeń DataEngine)
- `packages/shared/src/lib/query/engine.ts` i `query/join-utils.ts`
- `packages/shared/src/lib/indexers/status-log.ts`, `error-log.ts`
- `packages/core/src/modules/query_index/lib/engine.ts` (HybridQueryEngine, najwięcej kodu knex — ~1900 LoC z intensywnym QB)
- `packages/core/src/modules/query_index/lib/{indexer,coverage,purge,reindexer,subscriber-scope,search-tokens}.ts`
- `packages/core/src/modules/notifications/lib/notificationService.ts`
- `packages/core/src/modules/messages/api/{route.ts,unread-count/route.ts}`
- `packages/core/src/modules/customers/{cli.ts,api/utils.ts,api/interactions/route.ts,lib/interactionProjection.ts}`
- `packages/search/src/di.ts`, `search/workers/*`, `search/subscribers/*`, `search/api/reindex*`
- `packages/core/src/modules/translations/{lib/apply.ts,commands/translations.ts,api/context.ts,subscribers/cleanup.ts}`
- `packages/enterprise/src/modules/{sso/services/hrdService.ts,record_locks/lib/recordLockService.ts}`
- `packages/core/src/modules/{attachments/api/route.ts,attachments/api/library/route.ts,entities/api/relations/options.ts,inbox_ops/lib/messagesIntegration.ts,sales/data/enrichers.ts}`

**Decyzja architektoniczna do podjęcia:**

- **Opcja A (zgodna z v7):** przepisać cały raw-SQL layer na Kysely (`em.getKysely()`); odłożyć typy `Knex` i zastąpić typami Kysely. Dużo pracy (dialekty query buildera się różnią), ale zgodne z kierunkiem MikroORM.
- **Opcja B (bridge):** zainstalować `knex` jako bezpośrednią zależność, uzyskać pg pool przez `em.getConnection().getClientConnection()` i utworzyć instancję `knex({ client: 'pg', connection: ... })` raz na bootstrap; udostępnić przez DI (`container.resolve('knex')`). Minimalne zmiany w istniejącym kodzie, ale tworzymy drugi connection pool i tracimy synchronizację z transakcjami MikroORM. **Odradzam** — zepsuje transakcje.
- **Opcja C (hybryda):** utrzymać bazę wywołań ale zastąpić `getKnex()` warstwą adaptera nad Kysely dla najczęstszych wzorców (raw SELECT/INSERT/UPDATE/DELETE), a pozostałe skomplikowane zapytania przepisać natywnie. Pragmatyczne dla query_index, gdzie jest >1800 LoC knex.

**Rekomendacja:** Opcja A z etapowym wdrażaniem, ale warto ustalić z zespołem przed implementacją.

### 3. Zmiana typów `FilterQuery` i `RequiredEntityData` (6–8 błędów na pakiet)

v7 zaostrzył `FilterQuery<T>` (pojawia się `NoInfer<T>`) i `RequiredEntityData` — miejsca z `em.create()` i `em.findOne(filter)` mają subtelne mismatch'e typów. Widoczne głównie w `shared/src/lib/data/engine.ts` i generycznych helperach encryption/find. Wymagają:

- dodania jawnych `T` zamiast wnioskowania,
- ewentualnie castów `as FilterQuery<T>` jeżeli TS 5.8 nie zawęża,
- przejrzenia wzorców `em.create(EntityClass, data)` w commandach.

### 4. Zmiany w konfiguracji `pool` / `driverOptions` — `shared/src/lib/db/mikro.ts`

v7 przekazuje `PoolConfig` z `pg` (nie z knex) — **`acquireTimeoutMillis` nie istnieje**. Trzeba:

- usunąć `acquireTimeoutMillis` (brak odpowiednika w `pg.Pool`) lub zmapować do `connectionTimeoutMillis`,
- zweryfikować że `destroyTimeoutMillis` też nie jest cichym no-op (to knex-specific),
- zweryfikować że `driverOptions.idle_in_transaction_session_timeout` dalej działa — v7 przekazuje `driverOptions` bezpośrednio do `pg.Pool`; dla parametrów runtime Postgresa należy użyć `options: '-c idle_in_transaction_session_timeout=...'`.

Zweryfikować też że `MikroORM.init<PostgreSqlDriver>` zwraca odpowiednio zawężony typ — obecnie TS narzeka na `PostgreSqlEntityManager<PostgreSqlDriver>` brakujących w generyku. Możliwe rozwiązanie: `MikroORM.init<PostgreSqlDriver, PostgreSqlEntityManager<PostgreSqlDriver>>({...})`.

### 5. Drobne cleanupy

- `packages/shared/src/lib/di/container.ts:45` — `orm` może być `null` (nowy strict check w v7).
- Zweryfikować że nie ma gdzieś `@Transactional()` na syncowych metodach — v7 wymaga `async`.
- Zweryfikować że nie ma string entity references (`em.find('User', ...)`, `@ManyToOne('User')`) — to teraz błędy. (grep nie znalazł, ale warto przebiec pełną listą).
- `Array` properties mogą być teraz domyślnie JSON (vs. v6 ArrayType) — zweryfikować czy jakieś `string[]` column'y nie wymagają jawnego `type: ArrayType`, bo inaczej migracje wygenerują diff na typie kolumny.
- `forceUtcTimezone` jest teraz `true` domyślnie — dla Postgres to zazwyczaj no-op, ale jeśli gdziekolwiek w testach/scriptach pojawia się MySQL/MariaDB — sprawdzić.
- FK rules są oddzielone od `cascade` option — jeśli gdzieś używamy `cascade: [Cascade.ALL]` licząc na `ON DELETE CASCADE`, trzeba jawnie ustawić `deleteRule: 'cascade'` / `updateRule: 'cascade'`.

### 6. Aktualizacje dokumentacji i speców

- `.ai/specs/implemented/SPEC-003-2026-01-23-notifications-module.md`, `SPEC-002-2026-01-23-messages-module.md`, `SPEC-004-2026-01-23-progress-module.md`, `SPEC-018-2026-02-05-safe-entity-flush.md`, `SPEC-045b-data-sync-hub.md` oraz tutoriale w `apps/docs/docs/` zawierają snippets z `persistAndFlush`/`getKnex` — wymagają aktualizacji przykładów po migracji.
- `BACKWARD_COMPATIBILITY.md` — wpisać notki przy kategoriach #3 (function signatures) i #8 (DB schema) o efektach zmian v7.

## Rekomendowana kolejność prac (etapowo, merge‑friendly)

1. **Naprawa fundamentów (shared + db bootstrap)** — blokuje wszystko:
   - `shared/src/lib/db/mikro.ts`: pool/driverOptions, fix na typie `MikroORM<PostgreSqlDriver>` (może wymagać podania `EM` generyka: `MikroORM<PostgreSqlDriver, PostgreSqlEntityManager<PostgreSqlDriver>>`).
   - `shared/src/lib/data/engine.ts`: `persistAndFlush`→`persist().flush()`, `removeAndFlush`→`remove().flush()`, knex→Kysely (lub wprowadzić thin adapter typu `DbAdapter` zwracany przez DI, który wewnętrznie używa Kysely).
   - `shared/src/lib/query/engine.ts`, `query/join-utils.ts`, `indexers/*.ts`: zastępstwo `Knex` typu.
   - `shared/src/lib/di/container.ts`: null-check.
   - **Cel:** `npx tsc --noEmit` w `shared` = 0 błędów.
2. **Decyzja o Kysely vs. direct knex (przegląd z zespołem).**
3. **Core — query_index** (największy użytkownik knex — ~6 plików, 1 silnik QB): przepisać na Kysely lub na wybrany adapter. Uzupełnić istniejące testy jednostkowe (`hybrid-engine.test.ts` udaje `getKnex()` — zaktualizować mocks).
4. **Core — pozostałe moduły używające `getKnex`/`persistAndFlush`**: notifications, messages, customers, translations, attachments, entities, inbox_ops, sales, auth, workflows, business_rules. Jedna PR na moduł dla lepszej review.
5. **Enterprise / search / checkout / onboarding / webhooks / scheduler / sync-akeneo / gateway-stripe / cli**: mopowanie pozostałych wywołań — głównie refactor mechaniczny.
6. **Testy**: jednorazowy sweep — wszystkie 45 plików testowych z `persistAndFlush`, plus mocks `getKnex` w:
   - `packages/core/src/modules/notifications/__tests__/notificationService.test.ts`
   - `packages/core/src/modules/inbox_ops/lib/__tests__/messagesIntegration.test.ts`
   - `packages/core/src/modules/query_index/__tests__/{indexer,hybrid-engine}.test.ts`
   - `packages/core/src/modules/customers/commands/__tests__/undo.custom-fields.test.ts`
   - `packages/search/src/__tests__/workers.test.ts`
7. **Dokumentacja + specs** — aktualizacja snippetów.
8. **Verification gate:**
   - `yarn typecheck` — zielony
   - `yarn build` — zielony
   - `yarn test` — zielony
   - `yarn db:generate` — brak nieoczekiwanego schema diff (walidacja że `Array`/`ArrayType` i `forceUtcTimezone` nic nie zmieniło)
   - `yarn db:migrate` na świeżej bazie + `yarn test:integration` (ścieżki krytyczne: CRUD, search reindex, notifications, workflows).

## Ryzyka

- **Kysely dialekt** ma inny SQL builder niż knex — raw fragmenty (raw joins, CTE, window functions) w `query_index/lib/engine.ts` trzeba przemyślanie przepisać; istnieje ryzyko regresji w indexerze/FTS.
- **Transakcje**: jeśli wybierzemy opcję knex-bridge, istnieje ryzyko rozjechania transakcji MikroORM vs. knex — cały spec `SPEC-018 safe entity flush` może być dotknięty.
- **`forceUtcTimezone=true` default** — weryfikacja że wszystkie timestampy dalej odpowiadają UTC (powinno, ale warto sprawdzić testami integracyjnymi).
- **Generowanie migracji** — pierwsze uruchomienie `yarn db:generate` po v7 może wyprodukować diff (np. zmiany FK rules po oddzieleniu od `cascade`). Trzeba zweryfikować i albo przyjąć nowy baseline, albo zaktualizować encje tak by migracja była no-op.
- **Kaskada typów** — prawie każdy pakiet ciągnie błędy z `shared`. Etap 1 musi być zrobiony dobrze, bo wpływa na cały graf zależności.

## Metryki z audytu (punkt odniesienia)

- `persistAndFlush`: 125 wywołań / 45 plików
- `removeAndFlush`: 15 wywołań / 10 plików
- `getKnex()` callsites: ~150+ w kodzie produkcyjnym + ~15 w testach
- `import { Knex } from 'knex'`: 10+ plików (wszystkie zepsute bo pakiet niedostępny)
- Łącznie błędy typu: ~471 w 12 pakietach
- Pakiety nietknięte: `ui`, `queue`, `cache`

## Referencje

- Dokumentacja migracji v6→v7: https://mikro-orm.io/docs/upgrading-v6-to-v7
- Blog post: https://mikro-orm.io/blog/mikro-orm-7-released
- Lokalne inspekcje typów: `node_modules/@mikro-orm/core/EntityManager.d.ts`, `node_modules/@mikro-orm/postgresql/PostgreSqlConnection.d.ts`, `node_modules/@mikro-orm/sql/SqlEntityManager.d.ts`

# Decyzja developera:

Migrację należy wykonać w następujący sposób:
Opcja A (zgodna z v7): przepisać cały raw-SQL layer na Kysely (em.getKysely()); odłożyć typy Knex i zastąpić typami Kysely.