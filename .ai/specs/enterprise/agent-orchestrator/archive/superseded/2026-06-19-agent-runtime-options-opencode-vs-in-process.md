> 🗂️ **Reorg 2026-06-22 · Status: SUPERSEDED (historical).** Decided or replaced by the implementation and the 2026-06-22 OpenCode specs. Kept for provenance only — do not use as a plan. Current: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md`.

# Agent Runtime Options — OpenCode vs. In-Process Framework (Evaluation)

> **Status:** Evaluation / decision note · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19
> **Relates to:** [`2026-06-19-agent-dispatch.md`](2026-06-19-agent-dispatch.md) (runtime-agnostic adapters), [`2026-06-19-agent-orchestration-step-and-proposal.md`](2026-06-19-agent-orchestration-step-and-proposal.md) (Proposal contract), [`2026-06-19-agent-identity-and-on-behalf-of.md`](2026-06-19-agent-identity-and-on-behalf-of.md) (no-bypass invariant, two-tier auth), [`2026-06-19-agent-orchestrator-conventions.md`](2026-06-19-agent-orchestrator-conventions.md)
> **Question evaluated:** Can we build internal agents in a *Claude-Agent-SDK-like* structure (agent + tools + skills + loop) and run them on **OpenCode embedded in OM**, given OpenCode supports skills, an agent loop, tools, MCP?

---

## TL;DR

Intuicja co do **struktury** (Claude-Agent-SDK-like: agent + tools + skills + loop) jest dobra — ale **„uruchamiać to na OpenCode w OM" jest dziś złym wyborem fundamentu.** OM-owy OpenCode to **legacy** powierzchnia, świadomie wygaszana, **bez typed output** i **bez bramki „propose-only"**. Bierzemy więc *ergonomię autorską* Claude SDK i kładziemy ją na **in-process framework (`runAiAgentObject`, object-mode)**, który daje to samo **plus** typed output, bramkę mutacji, natywny audyt i tenant-scoping. OpenCode zostaje **opcjonalnym, drugorzędnym runtime adapterem**.

---

## Reality check: czym jest OpenCode w OM (vs. założenie)

Założenie — „OpenCode obsługuje skille, agent loop, toole" — jest prawdziwe o **upstream** `sst/opencode`, ale **nie o tym, co jest realnie wpięte w OM**:

- OpenCode w OM to **zewnętrzny binarny serwer w Dockerze** (`opencode serve`, port 4096; `docker/opencode/{Dockerfile,entrypoint.sh}`), **nie** zależność npm, **nie** vendored source.
- **Wszystkie natywne narzędzia OpenCode są wyłączone** (`write/bash/edit/read/glob/grep` → `false` + `permission: deny` w generowanym `opencode.jsonc`). Używany jest **wyłącznie agent loop + klient MCP**, który gada z jednym serwerem OM MCP (`:3001/mcp`) i woła tylko `search` / `execute` (Code Mode) / `context_whoami`.
- **Skille / subagenty / SKILL.md OpenCode NIE są używane.** Czyli akurat te rzeczy, które chcesz wykorzystać, w OM nie są wpięte — musiałbyś je dopiero włączyć i ugovernować na legacy powierzchni. (Pliki `SKILL.md` w `.ai/skills/` to dev-workflow skille Claude Code, niezwiązane z runtime OpenCode.)
- Docs wprost (`apps/docs/docs/framework/ai-assistant/{architecture,overview}.mdx`): OpenCode to „the older AI surface that powers Cmd+K" i „shares nothing with the new framework". Produkt celowo odchodzi od niego.

**Przepływ (dla pełności):** Cmd+K → `POST /api/chat` (SSE) → `opencode-handlers.ts` → `OpenCodeClient` (HTTP) → OpenCode `:4096` → (agent loop) → z powrotem przez MCP do OM `:3001/mcp` (`search`/`execute`). Auth dwupoziomowy: Tier-1 `MCP_SERVER_API_KEY` (OpenCode→OM MCP), Tier-2 per-conversation `_sessionToken` (`sess_…`, 2h TTL, w tabeli `api_keys`, ownership wiązany przez `opencodeSessionId`).

---

## Dlaczego to zły fundament dla TEJ warstwy (4 twarde niezgodności)

1. **Brak typed output.** Ścieżka OpenCode zwraca `{ type:'text', text }` — brak schematu, brak walidacji. Cała architektura stoi na typed `AgentProposal` (Zod per capability). Z OpenCode dostałbyś free-form tekst i musiałbyś dokładać narzędzie `emit_proposal`, żeby wymusić strukturę.
2. **Brak bramki „propose-only".** Code Mode `execute` **wykonuje zapisy bezpośrednio** (limit ~20 mutacji, tylko RBAC + miękki prompt „zapytaj usera"). To łamie rdzeń tezy **„LLM proposes, OM disposes, OM executes after the gate"** oraz no-bypass/audit invariant z IDENTITY. `AgentProposal` + disposition (`business_rules` + `USER_TASK`) to **inny** mechanizm niż `ai_pending_actions` — a OpenCode nie ma nawet tego drugiego.
3. **Ciężki i kruchy jako runtime do dispatchu.** Wymaga 3-kontenerowego stacka (OpenCode + OM MCP `:3001` + app `:3000`); „zakończenie" jest wnioskowane z SSE `busy→idle` z heartbeatami i 5-min cap — słabe do batch/programmatic dispatch.
4. **Strategiczny dług.** Budowanie nowej, regulowanej (AI Act) warstwy decyzyjnej na świadomie wygaszanej powierzchni to zła inwestycja.

---

## Co jest SŁUSZNE w pomyśle — i jak to wziąć

Struktura w stylu Claude Agent SDK to dobry **model autorski**. Tyle że OM ma już jej odpowiednik **in-process** (`runAiAgentObject`, object-mode; `packages/ai-assistant/.../lib/agent-runtime.ts`), który daje to samo **plus** typed output, bramkę mutacji, natywny audyt i tenant-scoping.

| Claude Agent SDK | OM in-process framework (`ai_assistant`) | OpenCode w OM |
|---|---|---|
| system prompt / instructions | `AiAgentDefinition.systemPrompt` + `resolvePageContext` | `AGENTS.md` (system prompt) |
| allowed tools / permissions | `allowedTools` + `mutationPolicy` + per-step re-enforce | wszystkie native off; tylko OM MCP tools |
| custom tools (in-proc MCP `tool()`) | `defineAiTool` packs (typed) | Code Mode `search`/`execute` |
| MCP servers | OM MCP / in-proc tool packs | klient MCP → OM `:3001` |
| subagents | wiele `AiAgentDefinition` + **workflow** `SUB_WORKFLOW`/`INVOKE_AGENT` | nie używane |
| **skills (SKILL.md, progressive disclosure)** | **brak — do dodania w capability registry** | nie używane |
| hooks (Pre/PostToolUse) | GUARD pre/post hook + `loop.prepareStep/onStepFinish` | OpenCode questions API |
| agent loop | `loop.maxSteps/stopWhen/budget` (object-mode) | loop OpenCode (SSE) |
| **structured output** | **`output: { schema: Zod }` — natywnie typed** ✅ | **brak** ❌ |
| model selection | `AiModelFactory` (provider/model/tenant precedence) | env w `opencode.jsonc` |

**Wniosek z tabeli:** object-mode jest tu **„Claude-Agent-SDK minus coding bits, plus typed output + audit"** — czyli dokładnie to, czego potrzebują agenci biznesowi.

---

## Rekomendacja

1. **Primary internal runtime = in-process `runAiAgentObject` (object-mode), autorowany w stylu Claude Agent SDK.** To buildowalna, typed, ugovernowana ścieżka — i to ją „intends" sam codebase (`POST /api/ai_assistant/ai/chat-object`). To jest treść brakującego spec-a **„Internal Agent Runtime & Capability Registry"**.

2. **OpenCode = opcjonalny, drugorzędny `runtime: 'opencode'` adapter** w modelu runtime-agnostic z DISPATCH — tylko dla wąskich przypadków, gdzie free-form agent loop + Code Mode nad OpenAPI realnie pomaga (eksploracja, ad-hoc multi-tool reasoning). Warunki, żeby spełniał architekturę:
   - **(a)** owinąć go narzędziem MCP `emit_proposal` z Zod, żeby wymusić **typed Proposal**;
   - **(b) propose-only** — wyłączyć write-path `execute` (read-only Code Mode), bo egzekucja idzie przez efektory OM po bramce;
   - **(c)** sesja pod **agent principal** tokenem (IDENTITY two-tier auth — już istnieje);
   - **(d)** normalizacja SSE → `AgentRun` (TRACE adapter).
   - **Nie fundament — opcja.**

3. **„Skills" zaadoptuj jako koncept w capability registry, niezależnie od runtime.** To najtrwalszy zysk z pomysłu: pakiety wiedzy domenowej + bundli narzędzi przypięte do capability (progressive disclosure jak SKILL.md), konsumowane przez object-mode (i opcjonalnie przez adapter OpenCode). Działa dla obu runtime'ów, bo `AgentProposal` (Zod) jest kontraktem **niezależnym od tego, kto go wyprodukował** — o to właśnie chodzi w runtime-agnostic DISPATCH.

---

## Krytyczny caveat architektoniczny

Claude Agent SDK pozwala **LLM-owi sterować przepływem** (spawnowanie subagentów, decyzja o krokach). Teza **ADR-001 jest odwrotna**: przepływem steruje **deterministyczny `workflows`**, agent to *krok*. Bierzemy więc **ergonomię autorską** Claude SDK (jak *definiujesz* agenta, tools, skills, loop), ale **nie** jego model orkiestracji (LLM-as-controller). **Kontrolerem zostaje workflow** — inaczej cofniemy się do „LLM jako orkiestrator", co architektura świadomie odrzuca.

---

## Open standards stack (A2A + MCP + Skills + OTel) — „standard, nie nasz runtime"

Pytanie uzupełniające: *jaki OPEN-SOURCE STANDARD (nie nasz OM runtime) do uruchamiania agentów — skills, loop, subagents?*

**Kluczowe rozróżnienie:** nie ma JEDNEGO standardu „skill + loop + subagents". **„Loop" nie jest standaryzowany** — to wewnętrzna sprawa runtime'u. Standardy istnieją **na szwach (interop)**, nie w środku pętli. Właściwa odpowiedź to **kompozycja otwartych standardów na granicach** — dokładnie to, co zakłada DISPATCH (runtime-agnostic, A2A-first).

### Rekomendowany stack standardów (open, governed, NIE nasz runtime)

| Potrzeba | Otwarty standard | Governance | Gdzie w architekturze |
|---|---|---|---|
| **Uruchamianie agentów / subagenty / cross-runtime dispatch** | **A2A (Agent2Agent)** | Linux Foundation, Apache-2.0; natywnie: Bedrock AgentCore, Vertex Agent Engine, Foundry | DISPATCH `runtime`/transport; Agent Card = discovery; subagent = delegacja A2A |
| **Agent → narzędzia** | **MCP (Model Context Protocol)** | otwarty, de-facto standard; już w OM (`:3001/mcp`) | tool packs + tool-scope guard (GUARD/IDENTITY) |
| **Skills (progressive disclosure)** | **Agent Skills / `SKILL.md`** | otwarty format (Anthropic open-sourced), runtime-niezależny | reprezentacja skilla w capability registry — wspólna dla każdego runtime |
| **Trace / observability** | **OpenTelemetry GenAI semantic conventions** | CNCF, otwarty | normalizacja do `AgentRun/Span/ToolCall` (TRACE) |
| **Typed output (Proposal)** | **JSON Schema** (z Zod) | otwarty | kontrakt `AgentProposal.payload` — niezależny od runtime |

To jest **„open standard do uruchamiania agentów", a nie nasz runtime**: każdy zgodny runtime (in-house, Bedrock, Vertex, Foundry, OpenAI) wpina się przez **A2A** bez bespoke kodu, woła narzędzia przez **MCP**, nosi **Skills** w formacie `SKILL.md`, a OM zostaje **runtime-agnostic plane: records / disposition / audit**.

### A sam „loop/runtime" per-agent — cienka biblioteka OSS, nie framework-moloch

Wewnątrz pojedynczego agenta potrzebujesz tylko biblioteki: pętla + typed output + tool-calls. Ocena kandydatów OSS pod **nasze** wymogi:

| Kandydat | OSS / TS | Model-agnostic | Typed output | Skills | Subagents | A2A | Trace OTel | Werdykt dla OM |
|---|---|---|---|---|---|---|---|---|
| **Vercel AI SDK** (już macie) | ✅ / ✅ TS | ✅ | ✅ `generateObject` | ➖ (dodajesz) | ➖ (przez workflow) | ➖ (dodajesz adapter) | ✅ | **Najlepszy „loop engine"** — zero nowej zależności, typed, model-agnostic |
| **Mastra** | ✅ / ✅ TS | ✅ | ✅ | częściowo | ✅ | rośnie | ✅ | OK, ale **nakłada się na `workflows`** + własne DI/evals — ryzyko duplikacji |
| **OpenAI Agents SDK** | ✅ / TS+Py | ~ (LiteLLM) | ✅ | ➖ | ✅ (handoffs) | ➖ | trace domyślnie OpenAI | trace/model ciąży ku OpenAI |
| **Google ADK** | ✅ / Py+Java | ✅ | ✅ | ➖ | ✅ | ✅ natywnie | ✅ | Świetny A2A, ale **nie TS** — obcy w monorepo |
| **Claude Agent SDK** | ✅ / TS+Py | ➖ Claude-centric | ➖ (przez tool) | ✅ `SKILL.md` | ✅ | ➖ | ✅ | Najlepsze *skills/subagents*, ale Claude-centric + coding-loop |
| **LangGraph** | ✅ / Py-first | ✅ | ✅ | ➖ | ✅ | ➖ | ✅ | Graph = **kolizja z `workflows`** jako kontrolerem; ciężki |

### Konkretna rekomendacja standardów

**Standardy na szwach: A2A + MCP + Agent Skills (`SKILL.md`) + OTel GenAI + JSON Schema. Pętla per-agent: Vercel AI SDK (już pod `runAiAgentObject`). OM = runtime-agnostic disposition/audit plane.**

- **A2A** = otwarty standard „uruchamiania agentów i subagentów" (to wprost odpowiedź): subagent = delegacja A2A; nowy runtime = nowy Agent Card, zero bespoke.
- **MCP** = narzędzia (masz).
- **`SKILL.md`** = format skilli w capability registry (ten sam skill konsumuje object-mode i każdy A2A runtime).
- **Vercel AI SDK** = pętla + typed output dla agentów in-house (internal runtime = cienki wrapper na AI SDK, wystawiony też jako węzeł A2A).
- **OTel GenAI** = trace → `AgentRun`.

### Dlaczego spełnia WSZYSTKIE wymogi

- **Typed Proposal** → JSON Schema/Zod; AI SDK `generateObject` lub walidowany A2A artifact. ✅
- **Propose-only + „OM disposes/executes"** → runtime zwraca *Proposal* (artifact); egzekucja przez efektory OM po bramce. ✅
- **Governance narzędzi + no-bypass/audyt** → MCP tool-scope + agent principal (IDENTITY); A2A worker pod scoped, revocable credential. ✅
- **Tenant-scoping** → payload-by-reference + per-tenant token w A2A/MCP (DISPATCH). ✅
- **AI Act traceability** → OTel GenAI → niezmienny `AgentRun` (TRACE). ✅
- **Runtime-agnostyczność / open** → A2A: Bedrock/Vertex/Foundry/in-house wymienne bez bespoke. ✅
- **Skills / loop / subagents** → `SKILL.md` + AI SDK loop + A2A subagents. ✅

### Czego unikać

1. **Nie bierz monolitu (LangGraph/Mastra) jako kontrolera przepływu** — kolizja z `workflows`. Kontrolerem jest workflow, nie LLM/graph-framework.
2. **Nie buduj na OpenCode** (legacy, brak typed output, brak propose-only).
3. **Nie wymyślaj własnego protokołu** — A2A/MCP istnieją i są governed.

> Jednozdaniowo: **A2A = standard uruchamiania agentów (subagenty, dispatch, runtime-agnostyczność), MCP = narzędzia, `SKILL.md` = skille, OTel GenAI = trace; pętlę robisz na Vercel AI SDK, OM zostaje warstwą disposition/audit.**

---

## Decyzja (proponowana)

- **Adopt (standardy na szwach):** **A2A** (uruchamianie agentów / subagenty / cross-runtime) + **MCP** (narzędzia) + **Agent Skills `SKILL.md`** (skille) + **OTel GenAI** (trace) + **JSON Schema/Zod** (kontrakt Proposal). To jest „open standard, nie nasz runtime".
- **Adopt (loop per-agent):** **Vercel AI SDK** (już w OM, pod `runAiAgentObject`, object-mode) jako silnik pętli + typed output; internal runtime wystawiony też jako węzeł A2A.
- **Adopt (runtime in-house):** in-process object-mode jako *primary internal agent runtime*; autoring w stylu Claude Agent SDK; „skills" jako koncept w capability registry.
- **Optional / later:** `runtime: 'opencode'` adapter z warunkami (a)–(d) — tylko gdy konkretna capability tego potrzebuje; dowolny zewnętrzny runtime (Bedrock/Vertex/Foundry/OpenAI) przez A2A.
- **Reject:** OpenCode jako *fundament*; monolityczny framework (LangGraph/Mastra) jako *kontroler przepływu*; własny protokół zamiast A2A/MCP.

## Changelog

- **2026-06-19:** Utworzono na podstawie audytu integracji OpenCode w OM (kod + Docker + docs) i API in-process frameworku (`runAiAgentObject`, object-mode). Porównano Claude Agent SDK ↔ OM in-process ↔ OpenCode; rekomendacja: in-process primary, OpenCode opcjonalny adapter, „skills" w capability registry, workflow-as-controller.
- **2026-06-19:** Dodano sekcję „Open standards stack (A2A + MCP + Skills + OTel)" — otwarte standardy na szwach jako „standard, nie nasz runtime"; porównanie OSS loop-libów (Vercel AI SDK / Mastra / OpenAI Agents SDK / Google ADK / Claude Agent SDK / LangGraph); rozszerzono Decyzję o wybór standardów + Vercel AI SDK jako silnik pętli.
