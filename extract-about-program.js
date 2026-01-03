#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const inputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "essay.md");
const outputPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(__dirname, "dist", "about-the-program.md");

const markdown = fs.readFileSync(inputPath, "utf8");
const lines = markdown.split(/\r?\n/);

const headerPattern = /^##\s+About the Program\s*$/;
const startIndex = lines.findIndex((line) => headerPattern.test(line));
if (startIndex === -1) {
  console.warn("About the Program heading not found; skipping extract.");
  process.exit(0);
}

let endIndex = lines.length;
for (let i = startIndex + 1; i < lines.length; i += 1) {
  if (/^#{1,2}\s+/.test(lines[i])) {
    endIndex = i;
    break;
  }
}

let sectionLines = lines.slice(startIndex, endIndex);

function stripTrailingNewpage(linesToTrim) {
  let trimmed = linesToTrim.slice();
  while (trimmed.length && trimmed[trimmed.length - 1].trim() === "") {
    trimmed.pop();
  }
  if (trimmed.length >= 3) {
    const tail = trimmed.slice(-3);
    if (
      tail[0].trim() === "```{=latex}" &&
      tail[1].trim() === "\\newpage" &&
      tail[2].trim() === "```"
    ) {
      trimmed = trimmed.slice(0, -3);
    }
  }
  while (trimmed.length && trimmed[trimmed.length - 1].trim() === "") {
    trimmed.pop();
  }
  return trimmed;
}

sectionLines = stripTrailingNewpage(sectionLines);

if (!sectionLines.length) {
  console.warn("About the Program section was empty; skipping extract.");
  process.exit(0);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const output = `${sectionLines.join("\n").replace(/\s+$/, "")}\n`;
fs.writeFileSync(outputPath, output, "utf8");
