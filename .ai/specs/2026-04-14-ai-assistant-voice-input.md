# AI Assistant: Voice Input (Draft — Use Case Evaluation Pending)

## Status

**Draft — on hold pending product decision on inclusion.**

Reviewer feedback on the omnibus accessibility PR flagged voice input as the most debatable part: technically solid (WebSpeech + multi-provider Whisper fallback) but the use case in a CRM/ERP backoffice is niche. This spec captures the implementation ready to be cherry-picked, plus the open questions that need a product answer before the feature ships.

Tracked alongside `.ai/specs/2026-04-14-accessibility-wcag-and-preferences.md` (PR-A, merged). Voice and accessibility were bundled originally but are orthogonal — voice can ship (or be dropped) independently.

## TLDR

**Key Points:**
- Add a `VoiceMicButton` to the Command Palette and DockableChat chat inputs. Auto-select the best available transcription provider: browser `WebSpeechProvider` by default; server-backed `WhisperProvider` when the transcribe endpoint reports availability.
- Server proxy `POST /api/ai_assistant/transcribe` supports three backends in priority order: `WHISPER_API_URL` (self-hosted), `GROQ_API_KEY` (Groq Cloud), `OPENAI_API_KEY` (OpenAI whisper-1).
- Feature flag `VOICE_TRANSCRIPTION_DISABLED` forces the WebSpeech fallback without unsetting `OPENAI_API_KEY` (shared with OCR / embeddings / opencode / search).
- Includes fixes for two bugs identified during implementation review: WhisperProvider stop-vs-abort regression, and browser-side capability check before swapping providers.

**Scope:**
- `packages/ai-assistant/src/frontend/lib/voice-transcription.ts` — provider interface + `WebSpeechProvider` + `WhisperProvider`.
- `packages/ai-assistant/src/frontend/hooks/useVoiceInput.ts` — state machine (`idle|listening|error|unsupported`), lazy provider init in `useEffect`.
- `packages/ai-assistant/src/frontend/hooks/useVoiceProvider.ts` — auto-select with capability guard (see Bug #1 below).
- `packages/ai-assistant/src/frontend/components/CommandPalette/VoiceMicButton.tsx` — mic button with `aria-pressed` and live indicator.
- Wiring in `CommandInput.tsx`, `CommandPalette.tsx`, `DockableChat.tsx`.
- `packages/ai-assistant/src/modules/ai_assistant/api/transcribe/route.ts` — `GET` availability + `POST` proxy.
- `packages/ai-assistant/src/modules/ai_assistant/lib/transcription-provider.ts` — `resolveProvider()` extracted for testability.
- Settings page tile in `AiAssistantSettingsPageClient.tsx` — read-only status.
- `jest.config.cjs` — add `@open-mercato/shared` and `@open-mercato/ui` path mappers to allow voice UI tests to import cross-package.
- Dev deps — `@testing-library/jest-dom`, `@testing-library/react`, `jest-environment-jsdom` (tests only).
- `.env.example` — document `VOICE_TRANSCRIPTION_DISABLED`, `WHISPER_API_URL`, `WHISPER_API_KEY`, `WHISPER_MODEL`, `GROQ_API_KEY`.
- i18n keys for voice UI labels (EN/DE/ES/PL).

**Ready-to-cherry-pick commits on the backup tag** `backup/pre-split-accessibility-voice-input`:
- `8c4ce46f0` — `feat(ai-assistant): add VOICE_TRANSCRIPTION_DISABLED env flag`
- `e5a57d541` — `fix(ai-assistant): WhisperProvider.stopListening now sends instead of aborting`

## Open Questions (Product Decision Required)

1. **Is voice input in-scope for Open Mercato?** The concrete use case is unclear: how many backoffice users actually dictate into an order management system? Evaluation options:
   - Ship behind a feature flag default-off. Activate only when an operator opts in.
   - Ship as an opt-in preview in a niche accessibility context (e.g. motor-impairment users).
   - Drop entirely; keep only the accessibility shell improvements from PR-A.
2. **`VOICE_TRANSCRIPTION_DISABLED` default** — if the feature ships, should the env flag default to `true` (opt-in) or `false` (opt-out)?
3. **Provider priority** — is self-hosted Whisper the right default priority? Tenant-level provider selection is deferred in the original spec (Option B); should we reopen that discussion if voice graduates?
4. **Tenant-scoped config** — current design is server-wide (env vars). If voice lands in production, admins will want per-tenant control. How do we reconcile that with the shared `OPENAI_API_KEY`?

## Architecture

```
packages/ai-assistant/src/frontend/
├── lib/voice-transcription.ts             # VoiceTranscriptionProvider interface
│                                          # WebSpeechProvider, WhisperProvider
├── hooks/
│   ├── useVoiceInput.ts                   # state machine + transcript ref
│   └── useVoiceProvider.ts                # capability-aware auto-select
└── components/
    ├── CommandPalette/VoiceMicButton.tsx  # mic UI
    ├── CommandPalette/CommandInput.tsx    # voice props
    ├── CommandPalette/CommandPalette.tsx  # mounts button in chat form
    └── DockableChat/DockableChat.tsx      # mounts button in minimized + expanded

packages/ai-assistant/src/modules/ai_assistant/
├── lib/transcription-provider.ts          # resolveProvider() — server-side priority
├── api/transcribe/route.ts                # GET availability + POST proxy
└── backend/ai-assistant/.../page.tsx      # settings tile with read-only status
```

### Provider Priority (server side)

```
VOICE_TRANSCRIPTION_DISABLED truthy → resolveProvider() returns null → GET reports { available: false }
WHISPER_API_URL set                 → self-hosted Whisper (optional WHISPER_API_KEY header, optional WHISPER_MODEL)
GROQ_API_KEY set                    → Groq (whisper-large-v3-turbo default)
OPENAI_API_KEY set                  → OpenAI (whisper-1 fixed)
otherwise                           → null → WebSpeech fallback only
```

## Bugs Fixed / To Fix

### Bug #1 — `useVoiceProvider` capability check (TO FIX in this spec)

`useVoiceProvider()` currently sets a `WhisperProvider` whenever the server reports `available: true`, without checking whether the browser actually supports `navigator.mediaDevices.getUserMedia` and `MediaRecorder`. In browsers where WebSpeech works but MediaRecorder is limited (older Safari, iOS WebView, missing mic permission), this replaces a working fallback with an unsupported provider.

**Fix:**
```ts
React.useEffect(() => {
  let cancelled = false
  const hasMediaCapture =
    typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof window !== 'undefined'
    && typeof (window as any).MediaRecorder === 'function'

  if (!hasMediaCapture) return // keep WebSpeechProvider

  apiCall<TranscriptionAvailability>('/api/ai_assistant/transcribe', ...)
    .then(({ result }) => {
      if (cancelled || result?.available !== true) return
      setProvider(new WhisperProvider())
    })
    .catch(() => { /* keep WebSpeechProvider */ })

  return () => { cancelled = true }
}, [])
```

Regression test: mock `navigator.mediaDevices = undefined`, mock server reports `available: true`, assert provider stays `WebSpeechProvider`.

### Bug #2 — `WhisperProvider.stopListening` sends instead of aborting (FIXED, commit `e5a57d541`)

`stopListening()` unconditionally set `abortRequested = true` before calling `recorder.stop()`. The `onstop` handler checks `abortRequested` and skipped `sendToWhisper`, so captured audio was discarded and no upload ever happened. Fix scopes `abortRequested` to the pre-recording branch only; during an active recording, `recorder.stop()` flows into `sendToWhisper` as intended. Regression tests verify: stop-during-recording → POST to `/api/ai_assistant/transcribe`; stop-during-getUserMedia → no fetch.

## Implementation Plan

1. Cherry-pick `8c4ce46f0` + `e5a57d541` from backup tag onto the voice branch.
2. Add voice files from `backup/pre-split-accessibility-voice-input` (see file map in Scope above).
3. Apply Bug #1 fix with regression test.
4. Restore ai-assistant package.json / jest.config.cjs additions so voice tests run.
5. Add i18n keys.
6. Verify full voice suite passes: `yarn workspace @open-mercato/ai-assistant test`.

## Test Coverage

- `voice-transcription.test.ts` — provider priority, whitespace trimming, WHISPER_MODEL override, WHISPER_API_KEY header.
- `useVoiceProvider.test.tsx` — WebSpeech initial state, Whisper auto-select when available, fallback on error, **capability guard (new)**.
- `useVoiceInput.test.tsx` — state machine, stop/abort behavior, transcript assembly.
- `whisperProvider.test.ts` — stop-vs-abort regression.
- `voice-ui.test.tsx` — `VoiceMicButton` UI contract (aria-pressed, dot indicator).
- `transcription-provider.test.ts` (server) — `resolveProvider()` priority + disabled flag.
- `api/transcribe/route.test.ts` — availability, proxy success, upstream error includes `{ provider, providerStatus, detail }`.

## Backward Compatibility

- New API path `/api/ai_assistant/transcribe` — additive.
- New env vars — additive. Unset = feature dormant, identical behavior to pre-change.
- AI assistant i18n additions are additive.
- No existing chat flow changes.

## Changelog

- **2026-04-14** — initial scope baked into the omnibus spec.
- **2026-04-15** — extracted to this standalone draft after reviewer feedback held voice for separate evaluation. Bug #1 capability check fix moves here from the original PR.
