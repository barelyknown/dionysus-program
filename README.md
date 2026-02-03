# Dionysus Program — Static Essay

This repository contains a single static webpage that renders the essay “The Dionysus Program.” The layout is intentionally minimal and borrows from the tone of hellaprompter.com's article design: centered column, serif typography, gentle borders, and understated hover states. The repo ships prebuilt outputs for GitHub Pages; run `./build.sh` when you update the essay.

## Abstract

“The Dionysus Program” argues that Apollo-style control—precision, prediction, and process—cannot by itself guide open-ended progress. It pairs Apollo with Dionysus: ritualized containers that let teams dissolve and remake meaning without violence. The essay calls the speed of that metabolism an epimetabolic rate and treats raising it as the true scoreboard. It introduces anti-scapegoat rites (critique artifacts, not people), readiness gates that test for trust (Ren/Asabiyyah), aesthetic “heat” to make change bearable, and tragic postmortems that turn recognition into new structure. The result is a program for running Run Time and Ritual Time in deliberate alternation so groups can keep learning while staying human.

## Website

- https://www.dionysusprogram.com

## Project structure

```
├─ LICENSE                   # © 2025 Sean Devine. All rights reserved.
├─ build.sh                   # One-step HTML/PDF build script
├─ dist/                      # Generated artifacts (PDF + essay markdown copy live here)
├─ filters/remove-title.lua   # Removes the duplicate H1 for HTML & PDF
├─ filters/pdf.lua            # PDF-only tweaks (title paragraph + page breaks)
├─ index.html                 # Static page for GitHub Pages (generated)
├─ styles.css                 # Hand-tuned stylesheet (header includes PDF/Markdown download links)
├─ templates/page.html        # Pandoc HTML template
├─ templates/pdf.tex          # Pandoc LaTeX template for the PDF title page
└─ essay.md                   # Source markdown with metadata front matter (title, author, date, description, rights)
```

## Updating the essay

1. Edit `essay.md` (the YAML block at the top feeds metadata into the build template—update the `rights` line if the year changes).
2. Run the build script:
   ```bash
   ./build.sh
   ```
   This overwrites `index.html`, refreshes `dist/dionysus-program.pdf`, and copies `essay.md` into `dist/essay.md`. The script requires Pandoc; install it with `brew install pandoc` if it’s missing. The PDF step depends on `xelatex` (installable via `brew install mactex-no-gui`); if it isn’t available, the script will skip PDF generation with a notice.
3. Commit and push.

> If you prefer not to use the script, you can still run Pandoc manually with `pandoc essay.md --from=markdown --to=html5 --template=templates/page.html --standalone --lua-filter=filters/remove-title.lua -o index.html`.

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

## License

See `LICENSE` for the copyright notice. All rights reserved.
