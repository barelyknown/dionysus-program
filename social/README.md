# LinkedIn Autopilot

This subsystem manages one coordinated publication package: a canonical Note/LinkedIn body plus its short X adaptation. Every enabled channel must pass before any publisher is called.

The baseline cadence is three posts per week: Monday, Wednesday, and Friday at 5:30 AM America/Los_Angeles. The GitHub publishing runner uses the same weekdays. Preparation runs twice before each slot and stores a complete approved package on the calendar item. The publication runner does not research, draft, or score inline; it validates the package against the current publication-history fingerprint and then performs delivery.

Publication memory is used before, during, and after drafting. Before prose generation, the OpenAI idea developer receives the complete available Notes/LinkedIn and X corpus, turns the planned topic into a source seed, and must articulate a substantively distinct argument with a novelty score of at least 8/10. Exact or near-duplicate historical thesis text fails deterministically even if a model labels it novel. The canonical Note/LinkedIn body must then score at least 8/10 for novelty and 7.5/10 for engagement, in addition to passing the existing voice, clarity, grounding, policy, and deterministic memory checks. The exact scored body becomes the website Note body; it is not rewritten after scoring.

X generation and scoring happen during advance package preparation, before LinkedIn is sent. They receive up to 1,000 published X posts, reject semantic repeats during scoring, and run a final deterministic exact/near-duplicate check. X candidates deliberately vary between one and three short paragraphs instead of using one fixed cadence. If research cannot produce a recent-source bundle, preparation tries configured non-research content types for the same slot. If no canonical Note/LinkedIn/X package passes after those bounded fallbacks, preparation records the failure and the workflow alerts before the publication window.

One failed item never aborts the queue. Missing or stale packages are deferred within the delivery grace period and then expired explicitly; later prepared items are still processed. Scheduled preparation also fails visibly when the weekly planner supplied no upcoming item. A delivery API or downstream Note/X failure is recorded and alerts without silently generating replacement copy or retrying an uncertain external write.

The memory rebuild reads the complete generated note body when it is available, rather than relying only on the 280-character ledger excerpt. Developed ideas persist their seed, argument summary, closest historical post, novelty rationale, model, and history fingerprint on the calendar item for auditability.

## Local-first commands

```bash
npm run social:plan-week -- --dry-run
npm run social:scan-timely -- --dry-run --use-fixtures
npm run social:build-brief -- --item <calendar-item-id>
npm run social:generate-candidates -- --item <calendar-item-id> --use-fixtures
npm run social:score-candidates -- --item <calendar-item-id> --use-fixtures
npm run social:prepare-upcoming -- --dry-run --use-fixtures --now <iso-timestamp>
npm run social:publish-due -- --dry-run --use-fixtures
npm run social:x-oauth2-token -- --env-file /Users/seandevine/Code/dionysus-program/.env.social.local
npm run social:import-linkedin-analytics -- --input /absolute/path/to/Content_YYYY-MM-DD_YYYY-MM-DD_SeanDevine.xlsx
npm run social:import-linkedin-analytics -- --input /absolute/path/to/Content_YYYY-MM-DD_YYYY-MM-DD_SeanDevine.xlsx --delete-input
npm run social:audit-redundancy -- --dry-run --mode live --ref origin/main
npm run social:audit-redundancy -- --dry-run --mode live --ref origin/main --write-manifest social/history/redundancy-removals/YYYY-MM-DD.json
npm run social:audit-redundancy -- --apply-local --manifest social/history/redundancy-removals/YYYY-MM-DD.json
npm run social:rebuild-memory
npm run social:validate-state
npm run social:replay-run -- --run-id <run-id>
```

`social:audit-redundancy` uses a strict semantic standard (same central claim, causal mechanism, and practical implication) and keeps the newest record in each high-confidence cluster. A second independent full-text comparison must also conclude that a reasonable follower would feel they had practically already read the note, with at least 0.90 confidence. Auditing is non-destructive. A reviewed manifest can then be applied with `--apply-local`, which removes only redundant website note sources and marks them removed in the ledger. It never deletes LinkedIn or X posts. The complete removed note body is retained as non-rendered workflow memory in the publication ledger so future novelty checks still treat the argument as already published. Application fails closed if the published-history fingerprint, content hash, note path, retained record, both confidence thresholds, or external-preservation policy does not match the reviewed manifest.

The LinkedIn analytics importer writes one file, `social/state/linkedin-analytics/learning-dataset.json`, containing matched post-level metrics for posts created by this flow. Pass `--delete-input` to remove the workbook after a successful import.

## Provider modes

- `fixture`: deterministic local testing with no external calls
- `live`: real provider calls using local secrets

Set `SOCIAL_PROVIDER_MODE=live` or pass `--mode live` once you are ready to validate against real APIs.

## Advance preparation and Gemini Deep Research

`social:prepare-upcoming` selects planned items inside the configured horizon, verifies any existing package against the complete publication history, and otherwise prepares a new package. Research, novel-idea development, Note/LinkedIn scoring, and X preflight all finish here. A compact research bundle is retained in the calendar package so delivery does not depend on an ignored runner cache.

In live mode, Gemini research jobs are durable while pending:

- the first run submits a Deep Research job and stores the interaction id in `social/state/research-jobs.json`
- later runs poll the pending interaction
- once Gemini completes, the report is normalized into a recent-source bundle
- current Interactions API `steps[].content[]` reports and `annotations[].url` citations are parsed directly, with legacy output compatibility retained
- an invalid completed job is removed instead of poisoning every later slot
- a research failure can trigger a non-research fallback during preparation

## Required live secrets

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ZAPIER_LINKEDIN_WEBHOOK_URL`
- `X_CLIENT_ID`
- `X_CLIENT_SECRET`
- `X_ACCESS_TOKEN`
- `X_REFRESH_TOKEN`
- `GH_SECRET_UPDATE_TOKEN` (GitHub token with permission to update repository Actions secrets)

For X OAuth2 token setup, add a localhost callback such as `http://127.0.0.1:8787/x/callback` to your X app, then run `npm run social:x-oauth2-token -- --env-file /Users/seandevine/Code/dionysus-program/.env.social.local`.

Optional for Anthropic bakeoffs only:

- `ANTHROPIC_API_KEY`

Run fixture mode first. The workflows are thin wrappers around these same commands.
