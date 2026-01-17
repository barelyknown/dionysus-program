# Agent Loop Setup

## Prerequisites
- Node.js + npm (for Playwright)
- Python 3 (used by Playwright webServer to serve the static site)

Install Playwright browsers once:
```bash
npm install
npx playwright install
```

## Local preview
- Quick static preview: `open index.html`
- Optional local server (same as tests):
  ```bash
  python3 -m http.server 4173
  ```
  Then open http://localhost:4173

## Checks
Run the deterministic check pipeline:
```bash
./agent/check.sh
```

## One-hour loop
Runs iterative checks and logs artifacts. Default is **no-pause**:
```bash
./agent/work-hour.sh 60
```

Optional flags:
```bash
./agent/work-hour.sh 60 --pause
./agent/work-hour.sh 60 --no-pause --between 120 --interval 30
./agent/work-hour.sh 60 --build
./agent/work-hour.sh 60 --no-build
```
Artifacts land in `agent/artifacts/` and Playwright outputs in `playwright-artifacts/`.
Baseline screenshots for visual regression live in `e2e/__screenshots__/` and can be
updated with `npm run test:e2e:update`.

### Auto-change hook (optional)
The loop will run `agent/iterate.sh` once per iteration in no-pause mode and capture
its output in `agent/artifacts/<iteration>/iterate.log`. The default script calls the
Codex CLI to inspect Playwright screenshots defined in `agent/inspect.json`
(by default the home page header and table of contents) and apply one improvement.
If you want to customize behavior, edit `agent/iterate.md` or override the CLI flags
via environment variables:

```bash
CODEX_EXEC_FLAGS="--full-auto" ./agent/work-hour.sh 60
CODEX_MODEL=o3 ./agent/work-hour.sh 60
```

Screenshot controls (optional). When `agent/inspect.json` exists, it is used by default.
Use `INSPECT_CONFIG` to point to a different config, or delete/rename the default if
you prefer env-only settings.
```bash
INSPECT_SELECTOR=".page-header" ./agent/work-hour.sh 60
INSPECT_FULL_PAGE=1 ./agent/work-hour.sh 60
INSPECT_VIEWPORT_WIDTH=1200 INSPECT_VIEWPORT_HEIGHT=800 ./agent/work-hour.sh 60
INSPECT_JPEG_QUALITY=75 INSPECT_FORMAT=jpeg ./agent/work-hour.sh 60
INSPECT_CONFIG=/path/to/custom-inspect.json ./agent/work-hour.sh 60
INSPECT_START_SERVER=0 PLAYWRIGHT_BASE_URL=http://localhost:3000 ./agent/work-hour.sh 60
```

## Playwright base URL
Override the base URL if you already run a server elsewhere (this skips the built-in
Python web server):
```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000 ./agent/check.sh
```

## Build integration
`./agent/check.sh` will run `./build.sh` automatically when Pandoc is available.
Use `--no-build` to skip it or `--build` to require it (and fail if Pandoc is missing).

## Codex CLI requirements
Auto-iteration requires the Codex CLI (`codex`) on your PATH. Confirm with:
```bash
codex --help
```

## Optional: Codex MCP browser driving
If your Codex installation supports MCP servers, register a Playwright-capable MCP
server in your global Codex config. This is user-global, so do it once and keep it
outside this repo. Example template (adjust to your environment):
```bash
# Example only — replace with the MCP server your Codex build supports.
# codex mcp add playwright --command <playwright-mcp-binary> --args "--headless=false"
# codex mcp list
```
Verification: after adding the server, ensure Codex can open a page and take a
screenshot via the MCP tool. The repo still works without MCP via headless Playwright
in `./agent/check.sh`.
