# Run an Agent on OpenCode (Agent Orchestrator) — Windows, End-to-End

Goal: clone this branch and run a file-defined agent from the **backoffice Playground** with
**OpenCode as the runtime**. Follow the steps in order.

## How it connects

```
Browser Playground ─▶ Next.js app :3000 ─OPENCODE_URL─▶ OpenCode :4096 (Docker, agent runtime)
   (/backend/playground)   (orchestrator runner)              │
                                                  OPENCODE_MCP_URL + x-api-key
                                                              ▼
                                                    MCP server :3001 (yarn mcp:serve)
                                          submit_outcome / load_skill / run_skill_script
```

The app mints a per-run session token, OpenCode runs the agent and calls the MCP server's
orchestrator tools, the outcome is captured, persisted, and shown in the Playground.

---

## 1. Prerequisites (Windows)

- **Node.js 24**, **Git for Windows** (gives real `curl.exe`), **Docker Desktop** (running).
- **PowerShell** (run all `yarn` commands from the repo root).
- An **Anthropic API key** — the shipped example agents use `anthropic/claude-sonnet-4-5`.

> In PowerShell, `curl` is an alias; use **`curl.exe`** for the health checks below.

---

## 2. Clone, enable Yarn, start infra

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
corepack enable; corepack prepare yarn@4.12.0 --activate

git clone https://github.com/open-mercato/open-mercato.git
cd open-mercato
git checkout feat/agent-orchestrator-mvp

docker compose up -d postgres redis meilisearch   # infra only — NOT opencode yet
```

---

## 3. Configure the app `.env`

The `mercato` CLI and the app read **`apps/mercato/.env`**.

```powershell
Copy-Item apps\mercato\.env.example apps\mercato\.env
```

Edit `apps\mercato\.env` and make sure these are set (DB/Redis defaults match the infra above):

```ini
DATABASE_URL=postgres://postgres:postgres@localhost:5432/open-mercato
REDIS_URL=redis://localhost:6379
JWT_SECRET=any-long-random-string

OM_AI_PROVIDER=anthropic
OM_AI_MODEL=anthropic/claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...
# MCP_SERVER_API_KEY is added in Step 6 (after you create the key)
```

---

## 4. Bootstrap and start the app

```powershell
yarn dev:greenfield
```

Installs, builds, seeds, and starts the app on **http://localhost:3000**. **Copy the admin
credentials printed in the terminal.** Leave this running.

> The committed example agents already live in `docker/opencode/agents/` (the generator output
> ships with the repo), so nothing to author for the first run.

---

## 5. Create the API key via the backoffice UI

1. Open **http://localhost:3000/backend** and sign in with the admin credentials from Step 4.
2. Go to **Settings → AI Assistant → Settings**
   (`/backend/config/ai-assistant/settings`).
3. In **MCP Configuration**, click **Generate MCP Config → Generate API Key**.
4. **Copy the `omk_...` secret** (shown once).

---

## 6. Wire the key into both `.env` files

The same `omk_...` key authenticates OpenCode → MCP server. It must appear in **two** files
(Docker Compose reads the repo-root `.env`; the MCP server reads `apps/mercato/.env`).

**a) Append to `apps\mercato\.env`:**
```ini
MCP_SERVER_API_KEY=omk_your_key_here
```

**b) Create a repo-root `.env`** (consumed by the OpenCode container) — use the same key:
```ini
OM_AI_PROVIDER=anthropic
OM_AI_MODEL=anthropic/claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...
MCP_SERVER_API_KEY=omk_your_key_here
OPENCODE_MCP_URL=http://host.docker.internal:3001/mcp
OPENCODE_PORT=4096
```

Create it from PowerShell:
```powershell
Set-Content -Path ".env" -Value @"
OM_AI_PROVIDER=anthropic
OM_AI_MODEL=anthropic/claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...
MCP_SERVER_API_KEY=omk_your_key_here
OPENCODE_MCP_URL=http://host.docker.internal:3001/mcp
OPENCODE_PORT=4096
"@ -Encoding utf8
```

---

## 7. Start the MCP server (for OpenCode)

In a **new terminal** at the repo root:

```powershell
yarn mcp:serve        # production HTTP server on port 3001, two-tier auth
```

Per-run session tokens carry the Playground user's ACL; the agent must reach the orchestrator
tools, so your admin role (which grants `agent_orchestrator.agents.run`) is required.

---

## 8. Start the OpenCode container (agent runtime)

```powershell
docker compose up -d opencode
```

The container's entrypoint generates `opencode.jsonc` from the repo-root `.env` (provider, model,
MCP URL + key) and bind-mounts `docker/opencode/{agents,skills}/`.

---

## 9. Verify the chain

```powershell
curl.exe http://localhost:3001/health          # MCP server up
curl.exe http://localhost:4096/global/health    # OpenCode up
curl.exe http://localhost:4096/mcp              # {"open-mercato":{"status":"connected"}}
```

The third must show `status: connected`. If not, re-check the key matches in both `.env` files.

---

## 10. Run an agent from the Playground

1. Open **http://localhost:3000/backend/playground** (sidebar: **Agents → Playground**).
2. Select a **primary** example agent — `deals_health_check_file` or `support_resolution_advisor`.
3. Click **Insert sample** to fill valid input JSON, then click **Run**.
4. Watch the result + trace render (informative result or an actionable proposal).

You're done — the agent ran on OpenCode.

---

## (Optional) Author your own file agent

Create `packages/<pkg>/src/modules/<module>/agents/<id>/` with `AGENT.md` + `OUTCOME.md`
(plus optional `skills/`, `sub-agents/`, `tools/`). Then:

```powershell
yarn generate                  # re-emits docker/opencode/{agents,skills}/ + the manifest
docker compose up -d opencode  # restart — hot-reload is not guaranteed
```

Keep agents **propose-only**: read-only `tools` allowlist, no `isMutation:true` tools (rejected
at load). See `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`.

---

## Environment variables — what & where

| Variable | File | Purpose |
|----------|------|---------|
| `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` | `apps/mercato/.env` | App + MCP server core config |
| `OM_AI_PROVIDER`, `OM_AI_MODEL` | repo-root `.env` (+ app `.env`) | OpenCode provider/model (match the agent's model family) |
| `ANTHROPIC_API_KEY` | repo-root `.env` | LLM key passed to the OpenCode container |
| `MCP_SERVER_API_KEY` | **both** `.env` files (same value) | OpenCode → MCP auth (`x-api-key`); MCP server validates it |
| `OPENCODE_MCP_URL` | repo-root `.env` | How the container reaches the host MCP server (default shown) |
| `OPENCODE_PORT` | repo-root `.env` | Host port for OpenCode (default `4096`) |
| `OPENCODE_URL` | app `.env` (optional) | How the app reaches OpenCode (default `http://localhost:4096`) |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `curl.exe .../mcp` not `connected` | `MCP_SERVER_API_KEY` differs between the two `.env` files, or `yarn mcp:serve` isn't running on 3001 |
| Playground shows no agents | Sign in as admin (`agent_orchestrator.agents.run` needed); agent files present under `docker/opencode/agents/` |
| Agent run times out | OpenCode can't reach the model — check `ANTHROPIC_API_KEY` + `OM_AI_PROVIDER=anthropic` in repo-root `.env`; `docker compose logs opencode` |
| Run errors with auth | App can't reach OpenCode — confirm container is up (`docker compose ps`) and `OPENCODE_URL` is `http://localhost:4096` |
| Edited an agent, no change | `yarn generate` then `docker compose up -d opencode` (no hot-reload) |
| `host.docker.internal` unreachable | Ensure Docker Desktop is running (it provides the host gateway on Windows) |

Quick recap:
```powershell
docker compose up -d postgres redis meilisearch
yarn dev:greenfield                         # app :3000 — note admin creds
#   UI: Generate MCP Config → copy omk_ key → put in apps\mercato\.env AND repo-root .env
yarn mcp:serve                              # MCP server :3001
docker compose up -d opencode               # OpenCode runtime :4096
#   /backend/playground → pick agent → Insert sample → Run
```
