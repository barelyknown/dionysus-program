# Dionysus Program — Static Essay

This repository contains a single static webpage that renders the essay “The Dionysus Program.” The layout is intentionally minimal and borrows from the tone of hellaprompter.com's article design: centered column, serif typography, gentle borders, and understated hover states. The repo ships prebuilt outputs for GitHub Pages; run `./build.sh` when you update the essay.

## Abstract

“The Dionysus Program” argues that Apollo-style control—precision, prediction, and process—cannot by itself guide open-ended progress. It pairs Apollo with Dionysus: ritualized containers that let teams dissolve and remake meaning without violence. The essay calls the speed of that metabolism an epimetabolic rate and treats raising it as the true scoreboard. It introduces anti-scapegoat rites (critique artifacts, not people), readiness gates that test for trust (Ren/Asabiyyah), aesthetic “heat” to make change bearable, and tragic postmortems that turn recognition into new structure. The result is a program for running Run Time and Ritual Time in deliberate alternation so groups can keep learning while staying human.

## Website

- https://www.dionysusprogram.com

## Project structure

```
├─ LICENSE                   # © 2025 Sean Devine. All rights reserved.
├─ build.sh                   # One-step HTML/EPUB/KPF/PDF build script
├─ dist/                      # Generated artifacts (EPUB/KPF/PDF + markdown copies live here)
├─ filters/remove-title.lua   # Removes the duplicate H1 for HTML & PDF
├─ filters/pdf.lua            # PDF-only tweaks (title paragraph + page breaks)
├─ index.html                 # Static page for GitHub Pages (generated)
├─ styles.css                 # Hand-tuned stylesheet (header includes PDF/Markdown download links)
├─ templates/page.html        # Pandoc HTML template
├─ templates/pdf.tex          # Pandoc LaTeX template for the PDF title page
└─ essay.md                   # Main source markdown with metadata front matter (title, author, date, description, rights)
```

## Updating the essay

1. Edit `essay.md` for the main book text and appendices (the YAML block at the top feeds metadata into the build template—update the `rights` line if the year changes).
2. Run the build script:
   ```bash
   ./build.sh
   ```
   The full publication requires Pandoc **3.6.4**, XeLaTeX, Poppler (`pdftotext`), Playwright with matching Chromium, and a working Kindle Previewer converter. It produces HTML, Markdown, EPUB, KPF, and both screen and print PDFs.
3. Commit source changes before the release build, then commit generated artifacts separately and push. Outputs carry the source commit and UTC build time.

### Build tool setup (Apple Silicon macOS)

```bash
npm ci
./scripts/setup-build-tools.sh
brew install --cask mactex-no-gui
brew install poppler
```

The setup script downloads the native Pandoc 3.6.4 archive from the official release, verifies its SHA-256 checksum, and installs it under ignored `.tools/`. Builds select that copy explicitly instead of an unrelated `pandoc` on `PATH`. It does not replace a system installation. Run setup again safely on a new checkout. On other platforms, install native Pandoc 3.6.4 and set `PANDOC_BIN` to its absolute path ending in `/pandoc`. Changing the pin requires checking the PDF template with the new version; 3.12.1 is not currently compatible.

Install [Kindle Previewer 4](https://kdp.amazon.com/en_US/help/topic/G202131170). Both `/Applications` and `~/Applications` are supported. Previewer 4 uses `Contents/MacOS/KindlePreviewer4CLI` and double-dash flags; Previewer 3 uses its main executable and single-dash flags. Discovery prefers Previewer 4 over legacy command wrappers. `KINDLE_PREVIEWER_BIN` can select an explicit converter.

Some Kindle conversion components require Rosetta. On supported Apple Silicon Macs, install it with `softwareupdate --install-rosetta` and follow Apple's prompts. Then verify a real conversion with the preflight below. Rosetta is transitional: recheck Amazon's native conversion support before upgrading beyond macOS 27.

On this Mac, the build renderer selects the shared `~/node_modules/playwright` installation and its matching Chrome for Testing. If needed, install that browser with `node ~/node_modules/playwright/cli.js install chromium`. Elsewhere it uses the repository's Playwright package. `DIONYSUS_PLAYWRIGHT_MODULE` may select another explicit package path. The browser sandbox remains enabled; Codex must launch the build through its approved outside-command-sandbox path on macOS. Repository browser tests retain their own declared dependencies.

### Preflight and publication safeguards

```bash
./build.sh --check                  # Real PDF, EPUB-to-KPF, and browser probes; no publication changes
node --test scripts/build-safeguards.test.js
./build.sh                          # Full validated publication, including KPF
```

The build checks the pinned Pandoc version and actually exercises the PDF template, Kindle conversion, and browser before generation. It stages all generated outputs under ignored `.cache/`, validates nonempty files, EPUB/KPF archives, the KPF’s embedded source EPUB, source/revision consistency, PDF text and quote images, and only then replaces published outputs. Replacement rolls back on ordinary I/O errors. Failed build diagnostics remain in the staging directory. `dist/build-manifest.json` records tool versions and any exclusions. Independent context exports in `dist/` are preserved; this command does not regenerate the LLM-compressed context.

KPF conversion failure is fatal, including an exit-zero converter that produces no KPF. `./build.sh --skip-kpf` is the explicit exception: it records the exclusion and removes any old published KPF on success. PDFs are always required. The build never silently reuses a stale book file. Update copyright metadata in the source before committing; the build does not rewrite source metadata.

A lock prevents concurrent publication builds. After a forcibly killed process, confirm it is stopped before removing `.cache/publication.lock`. Abrupt termination during the final replacement is not a filesystem-wide atomic transaction; inspect the saved staging/backup directory before publishing from an interrupted checkout.

## Publishing to GitHub Pages

1. Create a new GitHub repository and push this code.
2. In the repository settings, open **Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and the `/ (root)` folder, then click **Save**.
5. GitHub will build the site and give you a Pages URL within a minute.

### Optional: Custom domain

1. In your DNS provider, create a CNAME record pointing your domain (e.g. `www.example.com`) to GitHub’s Pages host `username.github.io`.
2. In **Settings → Pages**, enter the same domain in the **Custom domain** field.
3. GitHub will automatically provision TLS after the DNS change propagates.

## Local preview

You can open `index.html` directly in a browser (double-click in Finder or `open index.html`) to preview the page without running any server.

## LinkedIn automation

The repo now includes a CLI-first social automation subsystem under [social/README.md](social/README.md). Start in fixture mode and validate locally before enabling live provider secrets or scheduled workflows.

## License

See `LICENSE` for the copyright notice. All rights reserved.
