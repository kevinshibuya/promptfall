# Promptfall

Where things live. Open one when the task touches it.

- `docs/spec/promptfall.md`: the product and architecture contract. Read the section for any
  surface you change.
- `GLOSSARY.md`: the project's words. Use them in code, docs, tickets and commits.
- `docs/adr/`: decisions and why they were made. Check them before reopening a settled choice.
- `docs/features.md`: what the game does today, one paragraph per feature.
- `.claude/skills/`: project skills, each loaded when its description matches the task.

## Rule

A PR that adds, removes or changes a feature updates `docs/features.md` in the same PR.

A ticket that touches `plugins/` carries `pnpm typecheck:plugin` in its Verify gate.
