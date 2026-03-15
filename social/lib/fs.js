const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureParent(filePath) {
  ensureDir(path.dirname(filePath));
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function readText(filePath, fallback = '') {
  if (!fileExists(filePath)) return fallback;
  return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, text) {
  ensureParent(filePath);
  fs.writeFileSync(filePath, text, 'utf8');
}

function readJson(filePath, fallback = null) {
  if (!fileExists(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function listFiles(dirPath, predicate = () => true) {
  if (!fileExists(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .map((name) => path.join(dirPath, name))
    .filter((filePath) => fs.statSync(filePath).isFile() && predicate(filePath))
    .sort();
}

module.exports = {
  ensureDir,
  ensureParent,
  fileExists,
  readText,
  writeText,
  readJson,
  writeJson,
  listFiles,
};

