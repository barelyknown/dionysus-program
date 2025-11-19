# Project Context: Dionysus Program

## Project Overview
This project is a minimalist static website and document publishing pipeline for the essay "The Dionysus Program". It is designed to render a high-quality reading experience in both HTML (for the web) and PDF (for download) using a single Markdown source.

The project relies on **Pandoc** for document conversion and **Bash** for build orchestration. It is hosted on GitHub Pages.

## Key Files & Directories

*   **`essay.md`**: The core content source. Written in Markdown with YAML frontmatter (Title, Date, Author, etc.). **All content edits happen here.**
*   **`build.sh`**: The build script. Generates `index.html` and `dist/dionysus-program.pdf` from `essay.md`.
*   **`styles.css`**: Custom CSS for the HTML output, focusing on typography and readability.
*   **`templates/`**:
    *   `page.html`: Pandoc HTML template for the web version.
    *   `pdf.tex`: Pandoc LaTeX template for the PDF version.
*   **`filters/`**: Lua filters for Pandoc to customize rendering (e.g., removing duplicate titles).
*   **`dist/`**: Destination for generated downloadables (PDF and raw Markdown).
*   **`index.html`**: The generated web page. **Do not edit manually.**

## Development & Usage

### Prerequisites
*   **Pandoc**: Required for all conversions.
*   **XeLaTeX (MacTeX)**: Required for PDF generation.

### Common Tasks

1.  **Editing Content:**
    Modify `essay.md`. Update the YAML frontmatter if necessary (e.g., updating the year or description).

2.  **Building the Project:**
    Run the build script to regenerate HTML and PDF artifacts:
    ```bash
    ./build.sh
    ```
    *   This updates `index.html` in the root.
    *   This updates `dist/dionysus-program.pdf` and `dist/essay.md`.

3.  **Previewing:**
    Open `index.html` in a local web browser to verify changes.

4.  **Deployment:**
    The project is deployed via GitHub Pages. Committing the generated `index.html` and pushing to the `main` branch triggers the update.

## Conventions
*   **Source of Truth**: `essay.md` is the single source of truth. Never edit `index.html` directly.
*   **Styling**: CSS changes should be made in `styles.css`.
*   **Git**: Commit generated assets (`index.html`, `dist/*`) alongside source changes to ensure the deployment is always in sync with the source.
