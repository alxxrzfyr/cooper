# CLAUDE.md

Read **[AGENTS.md](./AGENTS.md)**. The rules live there and are not duplicated here, because two
copies drift and the stale one is always the one someone follows.

## Notes for Claude specifically

- **Read `PRD.md` first.** Its "what it must never become" section exists because this project
  was already rebuilt once after being over-engineered. Take it literally.
- **Prefer deleting.** The failure mode here is addition, not omission. A smaller change that
  meets the requirement beats a more general one that also does.
- **Look at the running app.** Several real bugs in this codebase were invisible to a passing
  test suite and obvious in a browser.
- **Two failures means stop.** Report the diagnosis instead of trying a third variation.
- **Do not add an abstraction for a second implementation that does not exist yet.**
