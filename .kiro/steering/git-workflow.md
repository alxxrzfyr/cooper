# Git workflow

- Never commit directly to `main`. Branch from the latest `origin/main` for each change
  (`feat/…`, `fix/…`, `docs/…`, `test/…`, `chore/…`, `refactor/…`, or `hotfix/…`).
- Use Conventional Commits; explain why in the body.
- Push with `git push -u origin <branch>` and open a PR with `gh pr create --base main`,
  filling in `.github/pull_request_template.md`.
- Never force-push, merge, or deploy without the owner's explicit go-ahead.
