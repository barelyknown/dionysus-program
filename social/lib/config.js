const yaml = require('yaml');
const { readText } = require('./fs');
const { paths } = require('./paths');

function loadYaml(filePath) {
  return yaml.parse(readText(filePath, '')) || {};
}

function loadStrategy() {
  return loadYaml(paths.strategyConfig);
}

function loadWatchlists() {
  return loadYaml(paths.watchlistsConfig);
}

module.exports = {
  loadYaml,
  loadStrategy,
  loadWatchlists,
};

