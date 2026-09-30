# Cooper Personality, Guardrails, and Personal Deployment Design

Historical credential policy: the browser-key proposal below describes the earlier
implementation. The owner superseded it on 2026-10-01 with Cooper-provided Gemini
and Groq keys and complete BYOK removal. See the
[current provider decision](../../decisions/2026-09-30-included-ai-providers.md).
The funded runtime cutover has not been implemented; other guardrails remain in force.

## Goal

Give Cooper a recognizable joyful and jolly otter personality while making the AI boundary
explicit, cheaper to operate, and safe for a personal cloud deployment where each deployment
belongs to one user.

## Scope

This is an additive change to the existing AI conversation path. It does not add accounts, shared
multi-user tenancy, a new table, a background process, or an AI-agent tool system. The current
database, action validator, single-writer route, manual mode, and optional environment
configuration remain in place.

## Product decisions

### Cooper's identity

Cooper is a cheerful, jolly otter companion for the user's own tasks, events, and time. His voice
is warm, encouraging, lightly playful, concise, and practical. He does not guilt the user, become
overly chatty, pretend to have feelings or abilities he does not have, adopt a requested alternate
role, or claim that an action happened unless the application reports that it happened.

The identity is kept in one compact prompt block and reused by both the action parser and the
answer path. It is a voice contract, not an instruction to give the model tools or permission to
make changes.

### AI boundary

The model may propose one validated `Action` or return short text answering a question about the
user's own task data. It cannot write to the database, schedule a block, call a remote integration,
or alter application policy. `brain.py` remains model-free with respect to storage, and `app.py`
remains the only writer.

Titles, typed sentences, recent titles, and item summaries are untrusted data. They continue to
pass through `sanitize_for_prompt()` before being embedded in prompts. Model-shaped actions still
pass through `_sanity_check()` before execution. Model answers are accepted only when they are
non-empty, short, single-line text without obvious prompt-leakage or role-switching markers;
otherwise the existing deterministic fallback is used.

### Personal deployment and API keys

Each hosted deployment is for one person. No accounts or tenant model are introduced. The existing
`COOPER_GEMINI_API_KEY` environment variable remains a supported server-side fallback for local
or private deployments.

The Settings screen gains a masked Gemini API key field. A key entered there is stored only in the
browser's local settings and is included only on AI-mode `/api/say` requests. The backend accepts
that key for the duration of the request, uses an isolated `Brain` instance, and never stores,
returns, or logs it. Manual requests omit it and must not call Gemini.

The static Vite frontend remains deployable to a static host and uses `VITE_COOPER_API` to point at
the FastAPI backend. The backend continues to use `COOPER_ORIGIN` for CORS and
`COOPER_DATABASE_URL` for its database. Deployment documentation must state that the backend needs
a Python runtime and persistent storage; a static frontend deployment alone is not the whole app.

### Request and token economy

The implementation cannot increase a provider's quota or promise 1,000 requests per day. It will
reduce avoidable usage:

- obvious rules-parsable commands and question routing skip the action-generation call;
- action generation retains at most one bounded repair attempt for invalid JSON;
- Gemini generation sets a small output-token ceiling appropriate to JSON actions or short answers;
- answer context is capped to a useful number of sanitized item summaries;
- answer text remains capped by Cooper's existing character limit and a concise word limit.

## Data flow

```text
Settings key in browser
        |
        | AI request only
        v
POST /api/say {text, mode, gemini_api_key?}
        |
        +--> per-request Brain(key) or configured env-key Brain
        |          |
        |          +--> rules fast path
        |          +--> Gemini proposal / short answer
        |          +--> sanitize + schema + sanity checks
        |
        +--> app.py executes validated Action, or returns text
```

The browser key never appears in a response or in a persisted Cooper setting. The existing
environment key is still reported through the existing model-availability field so deployments
that configure it continue to work without the Settings field.

## Files and responsibilities

- `cooper/brain.py`: compact identity, output guardrails, per-request key construction support,
  rules fast path, Gemini token caps, and sanitized bounded answer context.
- `cooper/app.py`: accept an optional ephemeral Gemini key on `/api/say`, select the request Brain
  without mutating global state, and preserve the single writer and manual-mode guarantees.
- `frontend/src/App.tsx`: load/save/clear the browser-only key and expose whether AI is available
  from either the local key or the configured server key.
- `frontend/src/api.ts`: send the browser key only for AI-mode calls.
- `frontend/src/Chat.tsx`: explain the personal key setting and the cheerful Cooper identity in
  the AI opening copy where appropriate.
- `frontend/src/types.ts`: update request/view types only if the API shape requires it.
- `tests/test_cooper.py`: deterministic personality, prompt-boundary, answer, output-limit, and
  request-economy harness cases.
- `tests/test_api.py`: HTTP coverage for ephemeral key handling, manual-mode isolation, and the
  unchanged single-writer behavior.
- `frontend/src/App.test.tsx`: browser-settings and AI-availability behavior if the existing test
  harness can cover it without adding a new testing dependency.
- `README.md`: personal deployment and browser-key instructions, including the persistent-backend
  requirement and the fact that provider quota remains external.

## Failure behavior

- Missing browser and environment keys: rules parsing and manual mode continue to work; AI remains
  unavailable.
- Invalid or unreachable Gemini response: no database mutation occurs from that response; the
  existing rules/fallback or deterministic list response is returned.
- Suspicious answer text: discard it and use the existing non-model response path.
- Browser storage unavailable: the key field still works for the current page session if practical;
  failure to persist the key must not break manual capture.
- The key is never included in errors, logs, notifications, or response payloads.

## Verification

The change is complete only when:

1. focused backend tests demonstrate the failing guardrail cases before the implementation and pass
   after it;
2. `uv run pytest` passes;
3. `uv run ruff check . && uv run ruff format --check .` passes;
4. frontend tests and `npm run build` pass;
5. the app is run and the AI Settings field, manual mode, AI mode, and no-key state are inspected
   in a browser;
6. the diff confirms the pre-existing unstaged frontend changes were not overwritten.
