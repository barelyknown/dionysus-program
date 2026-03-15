const { fileExists, readText, writeText, ensureParent } = require('./fs');

function readJsonl(filePath) {
  if (!fileExists(filePath)) return [];
  const text = readText(filePath).trim();
  if (!text) return [];
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function appendJsonl(filePath, record) {
  ensureParent(filePath);
  const line = `${JSON.stringify(record)}\n`;
  const existing = fileExists(filePath) ? readText(filePath) : '';
  writeText(filePath, `${existing}${line}`);
}

module.exports = {
  readJsonl,
  appendJsonl,
};

