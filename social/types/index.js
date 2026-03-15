const extractedInsight = require('./extracted-insight');
const decoderRing = require('./decoder-ring');
const ritualRecipe = require('./ritual-recipe');
const archetypeDiagnosis = require('./archetype-diagnosis');
const highLindySourceTour = require('./high-lindy-source-tour');
const cautionaryTale = require('./cautionary-tale');
const fromTheMailbag = require('./from-the-mailbag');
const shortStory = require('./short-story');

const registry = {
  extracted_insight: extractedInsight,
  decoder_ring: decoderRing,
  ritual_recipe: ritualRecipe,
  archetype_diagnosis: archetypeDiagnosis,
  high_lindy_source_tour: highLindySourceTour,
  cautionary_tale: cautionaryTale,
  from_the_mailbag: fromTheMailbag,
  short_story: shortStory,
};

function getType(id) {
  return registry[id];
}

function listTypes() {
  return Object.values(registry);
}

module.exports = {
  registry,
  getType,
  listTypes,
};

