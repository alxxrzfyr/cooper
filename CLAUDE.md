# CLAUDE.md

The instructions for this repository live in **[AGENTS.md](./AGENTS.md)**. Read that file. It is
not duplicated here on purpose: two copies of the same rules drift apart, and the stale copy is
always the one someone follows.

## Claude-specific notes

- **Read before writing.** `AGENTS.md`, then `PRD.md`, then the relevant section of the spec at
  `docs/superpowers/specs/2026-08-29-ai-calendar-agent-design.md`. The spec is long; read the
  section that governs your change rather than the whole document.
- **One phase at a time.** `PRD.md` defines six phases. Work only within the current one. If a
  change would be easier "while you are in there", it is out of scope.
- **Verify before claiming.** Run the four gates in `AGENTS.md` and quote their output. An
  unverified completion claim is worse than an admitted blocker, because it costs a debugging
  session to discover.
- **Two failures means stop.** Do not attempt a third variation on a failing test. Report the
  failure, your diagnosis, and what you would try next.
- **Prefer deleting to adding.** This project's stated risk is scope creep, not missing
  features. If you can satisfy an acceptance criterion with less code, do that.
