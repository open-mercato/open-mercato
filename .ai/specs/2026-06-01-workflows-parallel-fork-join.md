# SPEC: Parallel Fork / Join for the Workflows Engine

> Status: **Draft — gotowy do pre-implement** · Data: 2026-06-01 · Scope: OSS
> Module: `packages/core/src/modules/workflows/`
> Related: `.ai/specs/analysis/ROADMAP-workflows-module-development.md` (WF-1, P0),
> `.ai/specs/2026-04-14-code-based-workflow-definitions.md`, `.ai/specs/2026-03-29-workflow-integration-flows.md` (zależny — zakłada FORK/JOIN)
> Issue: [open-mercato/open-mercato#2292](https://github.com/open-mercato/open-mercato/issues/2292) — część dot. `PARALLEL_FORK` / `PARALLEL_JOIN` (`WAIT_FOR_TIMER` z tego issue jest już zaimplementowany)

## TLDR

`PARALLEL_FORK` / `PARALLEL_JOIN` są zadeklarowane w `WorkflowStepType` (`data/entities.ts:19-20`)
i opisane w `user-guide/workflows/step-types.mdx`, ale silnik rzuca `STEP_TYPE_NOT_IMPLEMENTED`
(`lib/step-handler.ts:341-348`). Każda definicja z gałęziami równoległymi wybucha w runtime.

Ten spec dodaje współbieżne wykonanie gałęzi przez **wielotokenowy model wykonania**: FORK
rozdziela bieg na N **trwałych gałęzi** (`workflow_branch_instances`), które wykonywane są
**naprzemiennie pod jedną blokadą** (semantyka BPMN, brak prawdziwej współbieżności wątkowej),
każda z **prywatnym namespace contextu**; JOIN synchronizuje je w trybie **wait-all** i merguje
namespace'y z powrotem do `instance.context`. Gałąź może **niezależnie pauzować** (USER_TASK,
sygnał, timer, async activity), a awaria jednej gałęzi **anuluje pozostałe** i uruchamia
kompensację całej instancji (saga).

## Problem Statement

- Zadeklarowany, ale nieobsłużony typ kroku łamie kontrakt platformy: definicja z FORK/JOIN
  przechodzi walidację zapisu, lecz rzuca `STEP_TYPE_NOT_IMPLEMENTED` przy wykonaniu.
- Silnik jest **jednotokenowy**: `WorkflowInstance.currentStepId: varchar` (entities.ts:241),
  pętla `executeWorkflow` (workflow-executor.ts:293-476) advansuje pojedynczy krok i wybiera
  **tylko** `validAutoTransitions[0]` (workflow-executor.ts:382). Pauzy (`PAUSED`,
  `WAITING_FOR_ACTIVITIES`) i `pendingTransition` są na poziomie całej instancji.
- Realne procesy (równoległe zatwierdzenia, równoczesne wywołania integracji) są niewykonalne;
  spec integration-flows wprost zakłada FORK/JOIN jako dostępne.

## Goals / Non-Goals

**Goals**
- Działający `PARALLEL_FORK` (rozdział na N gałęzi) i `PARALLEL_JOIN` (synchronizacja wait-all).
- Niezależne pauzowanie i wznawianie pojedynczej gałęzi.
- Namespace contextu per gałąź + deterministyczny merge na JOIN (bez cichych kolizji kluczy).
- Anulowanie gałęzi-sióstr przy awarii + kompensacja całej instancji.
- Walidacja definicji (parowanie FORK↔JOIN, min. 2 gałęzie, zbieżność do JOIN).
- Pełne event sourcing + pokrycie unit + integration.

**Non-Goals (ta iteracja)**
- **Zagnieżdżone FORK** (fork wewnątrz gałęzi innego forku) — encja przewiduje `parentBranchId`,
  ale walidator **odrzuca** zagnieżdżenie; włączenie to osobna faza.
- Semantyka **wait-N / quorum / discriminator** — tylko wait-all.
- **first-completed / race** i automatyczne anulowanie przy spełnieniu częściowego warunku
  (poza ścieżką awarii).
- Authoring w wizualnym edytorze — patrz Faza 4 (może zostać wydzielona do osobnego specu).

## Resolved Design Decisions (bramka rozwiązana)

| Decyzja | Wybór | Konsekwencja |
|---|---|---|
| Model współbieżności | **Trwałe gałęzie** (tabela `workflow_branch_instances`) | Gałęzie są bytami pierwszej klasy; znana lista do anulowania i synchronizacji |
| Wykonanie | **Naprzemienne pod blokadą (BPMN)**, nie wątkowo równolegle | Brak wyścigu o pamięć; advansowanie jednej gałęzi na raz w transakcji |
| Semantyka JOIN | **Tylko wait-all** | JOIN przepuszcza, gdy wszystkie gałęzie terminalne (COMPLETED) |
| Pauzy w gałęzi | **Niezależne** (USER_TASK/sygnał/timer/async) | Resume musi targetować gałąź, nie instancję |
| Context gałęzi | **Namespace per gałąź**, merge na JOIN | Brak kolizji; deterministyczny merge + opcjonalny `outputMapping` |
| Awaria gałęzi | **Anulować siostry** + kompensacja instancji | Saga LIFO po eventach instancji (już instance-scoped) |

## Proposed Solution

### Conceptual model — tokeny

Wprowadzamy abstrakcję **tokena wykonania**. Token to „kursor" trzymający `currentStepId`,
`context`, `status`, `pendingTransition`. Dziś istnieje dokładnie jeden token = sama
`WorkflowInstance`. Po zmianie:

- **Root token** = `WorkflowInstance` (jak dziś, gdy nie ma aktywnych gałęzi).
- **Branch token** = `WorkflowBranchInstance` (po FORK; root token „śpi" do JOIN).

Pętla wykonawcza operuje na *aktywnych tokenach*. Bez FORK zachowanie jest 1:1 jak obecnie
(zero zmian behawioralnych — kluczowe dla BC).

```
RUNNING (root token na FORK)
        │ FORK: utwórz N branch tokenów, root token → stan FORKED (uśpiony)
        ▼
  ┌───────────────┬───────────────┐
  ▼               ▼               ▼
branch A         branch B        branch C
currentStepId    currentStepId   currentStepId
status ACTIVE    status PAUSED   status COMPLETED(@JOIN)
namespace{...}   namespace{...}  namespace{...}
  └───────────────┴───────────────┘
        │ gdy WSZYSTKIE gałęzie COMPLETED@JOIN (wait-all)
        ▼ merge namespace'ów → instance.context; root token → currentStepId = krok po JOIN
RUNNING (root token kontynuuje jednotokenowo)
```

### Data Model — nowa encja `WorkflowBranchInstance`

Nowa tabela `workflow_branch_instances` (entities.ts), scoped per tenant/org:

| Kolumna | Typ | Opis |
|---|---|---|
| `id` | uuid PK | |
| `workflow_instance_id` | uuid (FK id, fetch-by-id) | Instancja-rodzic |
| `fork_step_id` | varchar(100) | Krok FORK, który utworzył gałąź |
| `join_step_id` | varchar(100) | Sparowany JOIN, do którego gałąź zmierza |
| `branch_key` | varchar(100) | = `transitionId` tranzycji wychodzącej z FORK (stabilny identyfikator gałęzi) |
| `parent_branch_id` | uuid null | Pod zagnieżdżenie (w tej iteracji zawsze null; walidator blokuje) |
| `current_step_id` | varchar(100) | Pozycja tokena gałęzi |
| `status` | varchar(30) | `ACTIVE \| PAUSED \| WAITING_FOR_ACTIVITIES \| COMPLETED \| FAILED \| CANCELLED` |
| `context_namespace` | jsonb | Prywatny scope zapisów gałęzi |
| `pending_transition` | jsonb null | Per-gałąź odpowiednik `instance.pendingTransition` (async) |
| `error_message` / `error_details` | text / jsonb null | |
| `started_at` / `completed_at` | timestamptz | |
| `tenant_id` / `organization_id` | uuid | Scoping (NEVER cross-tenant) |
| `created_at` / `updated_at` | timestamptz | |

Indeksy: `(workflow_instance_id, status)`, `(workflow_instance_id, fork_step_id)`, `(tenant_id, organization_id)`.
Brak ORM-relacji między modułami (tu wszystko w obrębie workflows — dozwolone), FK po id.

**`WorkflowInstance`** — dodatki additive (nullable, brak zmiany istniejących):
- nowy status `FORKED` w `WorkflowInstanceStatus` (root token uśpiony, gdy biegną gałęzie).
- (opcjonalnie) `active_fork_step_id varchar null` — który FORK jest otwarty (pomaga UI i walidacji ponownego forku).

**`UserTask`** i **`WorkflowEvent`** — dodać `branch_instance_id uuid null` (additive), aby resume
i timeline wiedziały, której gałęzi dotyczy zdarzenie/zadanie.

**Migracja:** zaktualizować `data/entities.ts`, uruchomić `yarn db:generate`, zachować wyłącznie
SQL dla tej zmiany, zaktualizować `migrations/.snapshot-open-mercato.json` w tym samym commicie
(zgodnie z `packages/core/AGENTS.md` → Entity Schema And Migration Workflow). Nie uruchamiać
`yarn db:migrate`.

### Definition schema — FORK/JOIN config + walidacja

`workflowStepSchema` (`data/validators.ts`) — dodać opcjonalne configi:

```ts
// na kroku PARALLEL_FORK:
config: { joinStepId: string }                 // wymagane dla FORK
// na kroku PARALLEL_JOIN:
config: { forkStepId: string,                  // wymagane dla JOIN (parowanie zwrotne)
          outputMapping?: Record<string,string> } // opcjonalny lift namespace→top-level
```

Walidacja definicji (rozszerzenie `start-validator`/walidacji zapisu — fail-closed):
1. Każdy FORK ma `config.joinStepId` wskazujący istniejący krok typu JOIN; JOIN ma zwrotne `config.forkStepId`.
2. FORK ma **≥2** wychodzące tranzycje (`trigger: 'auto'`); JOIN ma **≥2** wchodzące tranzycje.
3. Każda ścieżka z FORK **zbiega się** do jego JOIN (analiza grafu; brak ścieżki omijającej JOIN, brak END wewnątrz gałęzi).
4. **Brak zagnieżdżenia** w tej iteracji: żadna ścieżka między FORK a jego JOIN nie zawiera kolejnego FORK → błąd walidacji `NESTED_FORK_NOT_SUPPORTED`.
5. Brak cykli FORK↔JOIN; `branch_key` (transitionId) unikalne w obrębie forku.

### Execution model — pętla naprzemienna (token-aware)

Refaktor wewnętrzny (lib, nie publiczne DI): wydzielić **token abstraction** — `step-handler`
i `transition-handler` operują na obiekcie tokena (`currentStepId`, `context`, `status`,
`pendingTransition`) zamiast bezpośrednio na `WorkflowInstance`. Root token = adapter na instancję
(zero zmian zachowania bez FORK). Sygnatury publicznych metod DI (`workflowExecutor.startWorkflow`,
`executeWorkflow`, `resumeWorkflowAfterActivities`) pozostają zgodne wstecznie; dodajemy nowe
funkcje branch-aware.

`executeWorkflow` (workflow-executor.ts) — nowa logika w obrębie istniejącej transakcji + pessimistic lock:

```
1. Wczytaj instancję (lock).
2. Jeśli instancja NIE ma aktywnych gałęzi (status != FORKED):
     → zachowanie jak dziś (root token), AŻ napotka krok FORK (patrz FORK handler).
3. Jeśli instancja jest FORKED:
     → pętla naprzemienna: dla każdej gałęzi o status=ACTIVE advansuj o JEDEN krok
       (ta sama logika co dziś, ale na branch tokenie: enterStep/executeStep/transition).
     → gałąź na swoim JOIN: status=COMPLETED (nie wykonuj poza JOIN), sprawdź wait-all.
     → gałąź pauzująca: status=PAUSED/WAITING_FOR_ACTIVITIES (zapis branch.pendingTransition), nie blokuje sióstr.
     → gałąź FAILED: anuluj siostry + completeWorkflow(FAILED) (kompensacja).
     → gdy WSZYSTKIE gałęzie COMPLETED@JOIN → odpal JOIN (merge + wznowienie root tokena).
     → gdy żadna gałąź nie jest ACTIVE (wszystkie PAUSED/WAITING) → return RUNNING (instancja czeka na zewnętrzny resume).
```

`maxIterations` (dziś 100) liczone per przebieg pętli; chroni przed pętlą nieskończoną także w trybie naprzemiennym.

### FORK handler (`step-handler.ts`)

Po wejściu w krok `PARALLEL_FORK`:
1. Zbierz **wszystkie** wychodzące tranzycje `auto` z forku (nie `[0]`).
2. Dla każdej: utwórz `WorkflowBranchInstance` (`fork_step_id`, `join_step_id` z `config.joinStepId`,
   `branch_key=transitionId`, `current_step_id` = `toStepId` tranzycji, `status=ACTIVE`,
   `context_namespace = {}`). Wykonaj activities tranzycji forka w kontekście gałęzi (sync/async jak zwykle).
3. `instance.status = 'FORKED'`, `instance.active_fork_step_id = forkStepId`.
4. Zaloguj `PARALLEL_FORK_OPENED` (eventData: forkStepId, joinStepId, branchKeys[]).

Efektywny **read-context gałęzi** = `{ ...instance.context (snapshot z chwili forku), ...branch.context_namespace }`.
Zapisy gałęzi idą **wyłącznie** do `branch.context_namespace`.

### JOIN handler + synchronizacja (wait-all)

Gdy gałąź dociera do swojego `join_step_id`:
1. Gałąź → `status=COMPLETED`, `completed_at` ustawione; **nie** wykonuje kroku po JOIN.
2. Sprawdź wszystkie gałęzie tego forku: jeśli **każda** jest COMPLETED → JOIN „fires".
3. **Merge namespace'ów** do `instance.context`:
   - deterministycznie: `instance.context.branches[branchKey] = branch.context_namespace` (bez cichych kolizji),
   - następnie opcjonalny `joinStep.config.outputMapping` (path → top-level), aby świadomie wynieść wybrane wartości.
4. `instance.status='RUNNING'`, `instance.active_fork_step_id=null`, `instance.currentStepId = <krok po JOIN>`
   (jedyna wychodząca tranzycja z JOIN). Usuń/zarchiwizuj branch tokeny (zostają w tabeli jako audit, status COMPLETED).
5. Zaloguj `PARALLEL_JOIN_COMPLETED` (eventData: forkStepId, mergedBranchKeys[]).
6. Kontynuuj normalną pętlę jednotokenową.

### Pauza/resume per gałąź

Każda ścieżka resume musi rozróżniać **root token** vs **branch token** (po `branchInstanceId`):

| Wyzwalacz | Dziś | Po zmianie |
|---|---|---|
| USER_TASK complete (`api/tasks/[id]/complete`) | wznawia instancję | jeśli `UserTask.branch_instance_id` ustawione → wznów gałąź; inaczej instancję |
| Sygnał (`signal-handler`) | instancja | targetuje gałąź czekającą na sygnał (po branchInstanceId/stepInstance) |
| Timer (`timer-handler`, job payload) | instancja | payload jobu niesie `branchInstanceId` → `fireTimer` wznawia gałąź |
| Async activity (`resumeWorkflowAfterActivities`) | instancja, jedna `pendingTransition` | per-gałąź `pending_transition`; worker payload niesie `branchInstanceId` |

Wzorzec wznowienia gałęzi: ustaw branch `status=ACTIVE`, odtwórz `pending_transition` (jeśli async),
po czym ponownie wejdź w `executeWorkflow` (tryb FORKED) — pętla naprzemienna dokończy synchronizację.
Jeśli wznowienie gałęzi powoduje, że jest ona ostatnią docierającą do JOIN → JOIN fires w tym samym przebiegu.

### Awaria gałęzi i kompensacja

Gdy gałąź → `FAILED`:
1. Wszystkie siostry tego forku z `status ∈ {ACTIVE, PAUSED, WAITING_FOR_ACTIVITIES}` → `CANCELLED`
   (zaloguj `PARALLEL_BRANCH_CANCELLED` per gałąź; anuluj powiązane otwarte `UserTask`/timery best-effort).
2. `instance.status='FAILED'` + `completeWorkflow(FAILED)`. Kompensacja działa bez zmian:
   `compensateWorkflow` idzie LIFO po `ACTIVITY_COMPLETED` eventach **instancji** (entities są instance-scoped,
   więc obejmuje aktywności wykonane we wszystkich gałęziach). Kolejność LIFO po `occurredAt` jest poprawna
   także dla aktywności z różnych gałęzi.
3. Zaloguj `PARALLEL_FORK_FAILED`.

### Nowe eventy (`events.ts`, `as const`)

Dodać (additive, niełamiące):
`workflows.branch.opened`, `workflows.branch.completed`, `workflows.branch.cancelled`,
`workflows.branch.failed`, `workflows.join.completed`.
Oraz wewnętrzne typy event-sourcing (`WorkflowEvent.eventType`): `PARALLEL_FORK_OPENED`,
`PARALLEL_BRANCH_COMPLETED`, `PARALLEL_BRANCH_CANCELLED`, `PARALLEL_JOIN_COMPLETED`, `PARALLEL_FORK_FAILED`.
Uruchomić `yarn generate` po zmianie `events.ts`.

## Backward Compatibility

- Wszystkie zmiany schematu **additive** (nowa tabela, nullable kolumny, nowy status `FORKED`).
  Brak zmian istniejących kolumn/typów. Patrz `BACKWARD_COMPATIBILITY.md` (DB schema = ADDITIVE-ONLY).
- Publiczne metody DI (`workflowExecutor.*`) zachowują sygnatury; token abstraction to refaktor wewnętrzny.
- Definicje bez FORK/JOIN wykonują się **bit-identycznie** (root token = stara ścieżka). To jest twardy wymóg
  i punkt kontrolny w testach (regresja istniejących TC-WF-001..013).
- Nowe pola w `events.ts` i nowe typy eventów są additive (event IDs = ADDITIVE-ONLY).

## Visual Editor (Faza 4 — może być wydzielona)

- Węzły React Flow `ParallelForkNode` / `ParallelJoinNode` (`components/nodes/`), rejestracja w mapie typów,
  ikony (`lib/node-type-icons.ts`), kolory statusów przez semantic tokens (DS: zero hardcoded kolorów).
- Edytor: dodawanie gałęzi (wiele krawędzi z FORK), wskazanie pary FORK↔JOIN, walidacja w UI z czytelnym błędem
  (`NESTED_FORK_NOT_SUPPORTED`, brak zbieżności do JOIN).
- Instance viewer: wizualizacja równoległych gałęzi i ich statusów (timeline per gałąź, `branch_instance_id` w eventach).
- i18n (en/es/de/pl) pod `workflows.stepTypes.*`, `workflows.parallel.*`.

## Phasing & Steps

**Faza 1 — Model danych + walidacja**
1. Encja `WorkflowBranchInstance` + dodatki nullable (`UserTask.branch_instance_id`, `WorkflowEvent.branch_instance_id`, instance `FORKED`/`active_fork_step_id`). Migracja + snapshot.
2. Schemat FORK/JOIN config w `validators.ts` + walidacja parowania/zbieżności/zakazu zagnieżdżenia. Unit testy walidacji.

**Faza 2 — Silnik (token abstraction)**
3. Refaktor `step-handler`/`transition-handler` na token abstraction; root-token adapter. Regresja TC-WF-001..013 musi przejść bez zmian.
4. FORK handler (tworzenie gałęzi, activities forka, status FORKED).
5. Pętla naprzemienna w `executeWorkflow` (advans gałęzi, wykrycie pauzy/awarii).
6. JOIN handler (wait-all, merge namespace + outputMapping, wznowienie root tokena). Unit testy: 2- i 3-gałęziowy happy path, merge, outputMapping.

**Faza 3 — Pauzy, resume, awaria**
7. Per-gałąź resume: USER_TASK, sygnał, timer, async activity (payloady jobów + `branch_instance_id`).
8. Awaria gałęzi → anulowanie sióstr + kompensacja instancji. Unit testy + saga.
9. Eventy (`events.ts` + event-sourcing typy), `yarn generate`. i18n bazowe.

**Faza 4 — Wizualny edytor (opcjonalnie osobny spec)**
10. Węzły FORK/JOIN, authoring gałęzi, walidacja UI, instance viewer per gałąź, i18n pełne, DS compliance.

## Integration & Test Coverage

Nowe integration specy `__integration__/TC-WF-014..` (self-contained: fixtury w setupie przez API, cleanup w teardown — `.ai/qa/AGENTS.md`):
- **TC-WF-014** FORK→2 gałęzie AUTOMATED→JOIN wait-all, completed, merge namespace.
- **TC-WF-015** FORK z gałęzią USER_TASK: jedna gałąź PAUSED, druga biegnie; ukończenie taska wznawia gałąź; JOIN fires.
- **TC-WF-016** FORK z gałęzią async activity (kolejka) + per-gałąź resume; JOIN po dokończeniu jobu.
- **TC-WF-017** Awaria w jednej gałęzi → siostry CANCELLED, instancja FAILED, kompensacja LIFO obejmuje aktywności obu gałęzi.
- **TC-WF-018** Walidacja: brak `joinStepId` / zagnieżdżony FORK / ścieżka omijająca JOIN → błąd zapisu definicji.
- **TC-WF-019** Regresja: istniejąca definicja bez FORK wykonuje się identycznie (root token).
- **TC-WF-020** Tenant scoping: gałęzie/taski/eventy nigdy cross-tenant.

API surface do pokrycia: `POST /api/workflows/instances` (start), `instances/[id]` (detail z gałęziami),
`instances/[id]/advance`, `tasks/[id]/complete` (branch-aware), `instances/[id]/signal` (branch-aware),
`POST /api/workflows/definitions` (walidacja FORK/JOIN).

## Risks & Failure Scenarios

| Ryzyko | Mitygacja |
|---|---|
| Refaktor token abstraction łamie istniejące ścieżki | TC-WF-001..013 jako gate regresji; root-token adapter 1:1 |
| Kolizje kluczy contextu między gałęziami | Namespacing `context.branches[branchKey]`; brak implicit top-level; jawny `outputMapping` |
| Zakleszczenie JOIN (gałąź nigdy nie dochodzi) | Walidacja zbieżności do JOIN; gałąź FAILED/CANCELLED liczona jako terminalna z awarią całości |
| Resume trafia w złą gałąź | `branch_instance_id` w UserTask/WorkflowEvent/payloadach jobów; testy TC-WF-015/016 |
| Podwójne odpalenie JOIN (równoległe resume) | Pessimistic lock na instancji + transakcja; wait-all liczony pod blokadą |
| Zagnieżdżony FORK przeoczony | Walidator `NESTED_FORK_NOT_SUPPORTED` fail-closed; TC-WF-018 |
| Sierocie taski/timery po anulowaniu gałęzi | Best-effort anulowanie + log; nie blokuje completeWorkflow(FAILED) |

## Open Follow-ups (poza zakresem)

- Zagnieżdżone FORK (parent_branch_id już w modelu).
- wait-N / quorum / discriminator (Q2 — odłożone).
- Analytics per gałąź (łączy się z WF-3 z roadmapy).

## Changelog

### 2026-06-01
- Bramka Open Questions rozwiązana (model trwałych gałęzi, BPMN-interleaved, wait-all, niezależne pauzy,
  namespace+merge, anulowanie sióstr). Dodano pełny design, fazowanie, BC, testy i ryzyka. Szkielet → Draft.
