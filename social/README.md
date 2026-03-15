# LinkedIn Autopilot

This subsystem manages LinkedIn planning, drafting, scoring, and publishing for Sean's profile.

## Local-first commands

```bash
npm run social:plan-week -- --dry-run
npm run social:scan-timely -- --dry-run --use-fixtures
npm run social:build-brief -- --item <calendar-item-id>
npm run social:generate-candidates -- --item <calendar-item-id> --use-fixtures
npm run social:score-candidates -- --item <calendar-item-id> --use-fixtures
npm run social:publish-due -- --dry-run --use-fixtures
npm run social:rebuild-memory
npm run social:validate-state
npm run social:replay-run -- --run-id <run-id>
```

## Provider modes

- `fixture`: deterministic local testing with no external calls
- `live`: real provider calls using local secrets

Set `SOCIAL_PROVIDER_MODE=live` or pass `--mode live` once you are ready to validate against real APIs.

## Gemini Deep Research behavior

In live mode, `scan-timely` is asynchronous:

- the first run submits a Deep Research job and stores the interaction id in `social/state/research-jobs.json`
- later runs poll the pending interaction
- once Gemini completes, the report is normalized into a research bundle and can feed timely scheduling

## Required live secrets

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ZAPIER_LINKEDIN_WEBHOOK_URL`

Run fixture mode first. The workflows are thin wrappers around these same commands.
