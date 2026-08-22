# Agent mission workflow

This repository keeps autonomous mission runtime data in ignored `.agent/`
files. The command surface is deliberately limited to five scripts:

```bash
npm run agent:mission-start -- --mission <id> --objective "<objective>" --baseline <commit>
npm run agent:status
npm run agent:run -- --timeout 180 -- npm run typecheck
npm run agent:check
npm run agent:check -- --full
npm run agent:evidence
```

`agent:mission-start` requires Node 22, a feature branch, a baseline descended
from `a4c74f9`, and no tracked pre-existing changes. Untracked `FRANK_*.md`
specifications are recorded but do not invalidate startup.

`agent:run` records an isolated log and status JSON per child command. It
refuses a third consecutive equivalent failed command until the caller supplies
`--force-after-diagnosis "<non-empty diagnosis>"`.

`agent:check` selects checks from all tracked files changed since the stored
baseline. Its normal formatting path touches only changed eligible tracked
files; `--full` is reserved for the final gate. `agent:evidence` writes JSON
and Markdown under `.agent/evidence/` by default. Final mission owners copy
the evidence to their durable report location.
