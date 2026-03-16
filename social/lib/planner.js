const fs = require('fs');
const path = require('path');
const { listTypes } = require('../types');
const { readJsonl } = require('./jsonl');
const { paths } = require('./paths');
const { normalizeText, getMemoryConflicts, overlapScore } = require('./memory');
const { localDateForWeekday, zonedDateFromLocal, formatIso, now } = require('./time');
const { sha256 } = require('./hash');
const { rankSourceEvidence } = require('./context');
const { readText, listFiles } = require('./fs');

function slugify(value) {
  return normalizeText(value).replace(/\s+/g, '-');
}

function titleCaseWords(value) {
  return String(value || '')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function loadLetterMailbagItems() {
  return listFiles(paths.lettersDir, (filePath) => filePath.endsWith('.txt')).map((filePath) => {
    const fullText = readText(filePath, '').trim();
    const stats = fs.statSync(filePath);
    const baseName = path.basename(filePath, '.txt');
    return {
      id: `letter-${baseName}`,
      provenance: path.relative(paths.repoRoot, filePath),
      captured_at: stats.mtime.toISOString(),
      title: baseName.replace(/_/g, ' '),
      attribution: `Not ${titleCaseWords(baseName)}`,
      full_text: fullText,
      source_kind: 'letter_to_editor',
    };
  }).filter((item) => item.full_text);
}

function loadMailbagItems() {
  const ledgerItems = readJsonl(paths.mailbagLedger)
    .filter((item) => item.quote && item.provenance && item.captured_at);
  const letterItems = loadLetterMailbagItems();
  return [...letterItems, ...ledgerItems];
}

function typeDeficitScore({ typeId, strategy, memory, plannedCounts = {}, plannedTotal = 0 }) {
  const targetWeight = strategy.content_types?.[typeId]?.target_weight || 0;
  const baselineTotal = Math.max(memory.published_count + plannedTotal, 1);
  const actualCount = (memory.typeCounts?.[typeId] || 0) + (plannedCounts[typeId] || 0);
  const expectedCount = baselineTotal * targetWeight;
  return expectedCount - actualCount;
}

function weeklyRotationScore({ typeId, plannedTypes = [], remainingSlots = 0 }) {
  const currentCount = plannedTypes.filter((plannedType) => plannedType === typeId).length;
  const previousType = plannedTypes[plannedTypes.length - 1] || null;
  const uniqueTypesUsed = new Set(plannedTypes);

  let score = 0;
  if (currentCount === 0) score += 2.5;
  if (previousType === typeId) score -= 3;
  if (currentCount > 0) score -= currentCount * 1.25;

  const stillNeedVariety = uniqueTypesUsed.size < Math.max(0, 4 - remainingSlots);
  if (stillNeedVariety && currentCount === 0) score += 1;

  return score;
}

function normalizeTopicEntry(entry) {
  if (typeof entry === 'string') {
    return {
      thesis: entry,
      preferred_types: [],
      research_weight: 0,
    };
  }
  return {
    thesis: entry?.thesis || entry?.topic_thesis || entry?.text || '',
    preferred_types: Array.isArray(entry?.preferred_types) ? entry.preferred_types : [],
    research_weight: Number(entry?.research_weight || 0),
  };
}

function topicText(entry) {
  return normalizeTopicEntry(entry).thesis;
}

const TYPE_KEYWORDS = {
  extracted_insight: ['epimetabolic', 'knowledge', 'myth', 'truth', 'trust', 'ritual time', 'run time', 'li', 'ren', 'alchemy', 'readiness'],
  decoder_ring: ['ai', 'leadership', 'management', 'theater', 'adoption', 'reorg', 'collapse', 'failure', 'temporary authority'],
  ritual_recipe: ['crossing', 'postmortem', 'calendar', 'cooling', 'scrap heap', 'ritual', 'covenant', 'anti-scapegoat', 'small fractal'],
  archetype_diagnosis: ['management theater', 'oligarchic', 'pyrrhic', 'sitting duck', 'outpaced', 'overwhelmed', 'death spiral', 'archetype'],
  high_lindy_source_tour: ['myth', 'cincinnatus', 'confucius', 'girard', 'durkheim', 'eliade', 'weber', 'turner', 'taleb', 'mauss'],
  cautionary_tale: ['crime', 'collapse', 'warning', 'theater', 'struggle', 'cult', 'burn', 'betray'],
  from_the_mailbag: ['note', 'message', 'inbox', 'mailbag'],
  short_story: ['story', 'identity', 'myth', 'meaning', 'human'],
};

function keywordFitScore({ typeId, thesis }) {
  const haystack = normalizeText(thesis);
  const keywords = TYPE_KEYWORDS[typeId] || [];
  if (keywords.length === 0) return 0;
  let hits = 0;
  for (const keyword of keywords) {
    if (haystack.includes(normalizeText(keyword))) hits += 1;
  }
  return hits / keywords.length;
}

function evidenceCoverageScore({ topicThesis, context, contentType }) {
  const ranked = rankSourceEvidence({
    topicThesis,
    contextText: context.contextText || '',
    pullQuotes: context.pullQuotes || [],
    contentType,
  });
  const topScores = ranked.slice(0, 3).map((entry) => entry.score || 0);
  if (topScores.length === 0) return 0;
  return topScores.reduce((sum, value) => sum + value, 0) / topScores.length;
}

function noveltyScore({ topicThesis, memory }) {
  const recentTopics = memory.recent_topics || [];
  if (recentTopics.length === 0) return 1;
  const maxOverlap = recentTopics.reduce((best, record) => (
    Math.max(best, overlapScore(topicThesis, record.topic_thesis || ''))
  ), 0);
  return Math.max(0, 1 - maxOverlap);
}

function researchabilityScore({ topicThesis, watchlists }) {
  const haystack = normalizeText(topicThesis);
  const candidates = [
    ...(watchlists.seed_topics || []),
    ...(watchlists.adjacent_domains || []),
    ...((watchlists.keyword_clusters || []).flat()),
    ...((watchlists.entities?.companies || [])),
    ...((watchlists.entities?.thinkers || [])),
    ...((watchlists.entities?.newsletters || [])),
  ];
  if (candidates.length === 0) return 0;
  const hits = candidates.reduce((count, value) => count + (haystack.includes(normalizeText(value)) ? 1 : 0), 0);
  return Math.min(1, hits / 6);
}

function scoreTopicCandidate({
  topicEntry,
  typeId = null,
  strategy,
  memory,
  context,
  usedTopics = new Set(),
  watchlists = null,
}) {
  const topic = normalizeTopicEntry(topicEntry);
  if (!topic.thesis) {
    return { topic, score: Number.NEGATIVE_INFINITY, reasons: ['missing_topic_text'] };
  }
  if (usedTopics.has(normalizeText(topic.thesis))) {
    return { topic, score: Number.NEGATIVE_INFINITY, reasons: ['already_used_in_plan'] };
  }

  const conflicts = getMemoryConflicts({
    record: { topic_thesis: topic.thesis, hook: '', angle: '', source_refs: [] },
    memory,
    strategy: { content_types: {} },
  });
  if (conflicts.includes('topic_duplication')) {
    return { topic, score: Number.NEGATIVE_INFINITY, reasons: ['topic_duplication'] };
  }

  const evidence = evidenceCoverageScore({
    topicThesis: topic.thesis,
    context,
    contentType: typeId || 'extracted_insight',
  });
  const novelty = noveltyScore({ topicThesis: topic.thesis, memory });
  const typeFit = typeId ? keywordFitScore({ typeId, thesis: topic.thesis }) : 0;
  const preferredTypeBonus = typeId && topic.preferred_types.includes(typeId) ? 1 : 0;
  const researchability = watchlists ? researchabilityScore({ topicThesis: topic.thesis, watchlists }) : 0;
  const score = (evidence * 4.5) + (novelty * 3.5) + (typeFit * 2.5) + (preferredTypeBonus * 2) + (researchability * 1.5) + (topic.research_weight || 0);

  return {
    topic,
    score,
    reasons: {
      evidence,
      novelty,
      typeFit,
      preferredTypeBonus,
      researchability,
      researchWeight: topic.research_weight || 0,
    },
  };
}

function selectTopicForType({ topics, typeId, strategy, memory, context, usedTopics }) {
  const scored = (topics || [])
    .map((topicEntry) => scoreTopicCandidate({
      topicEntry,
      typeId,
      strategy,
      memory,
      context,
      usedTopics,
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);

  const winner = scored[0]?.topic?.thesis || topicText(topics?.[0]) || 'How organizations adapt without becoming theatrical or brittle.';
  usedTopics.add(normalizeText(winner));
  return winner;
}

function selectResearchTopic({ topics, strategy, memory, context, watchlists }) {
  const scored = (topics || [])
    .map((topicEntry) => scoreTopicCandidate({
      topicEntry,
      strategy,
      memory,
      context,
      usedTopics: new Set(),
      watchlists,
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);

  return scored[0]?.topic?.thesis || topicText(topics?.[0]) || null;
}

function buildCalendarItem({
  strategy,
  date,
  slot,
  type,
  topicThesis,
  angle,
  hook,
  researchBundleId = null,
  timelySubject = null,
}) {
  const scheduledAt = zonedDateFromLocal({ date, time: slot.time, timeZone: strategy.timezone });
  const id = sha256(`${date}:${slot.time}:${type.id}:${topicThesis}`).slice(0, 12);
  return {
    id,
    scheduled_date: date,
    scheduled_time: slot.time,
    scheduled_at: formatIso(scheduledAt),
    timezone: strategy.timezone,
    weekday: slot.weekday,
    slot_type: slot.slot_type,
    status: 'planned',
    content_type: type.id,
    pillar: type.pillar,
    topic_thesis: topicThesis,
    angle,
    hook,
    source_bundle_id: researchBundleId,
    timely_subject: timelySubject,
    draft_ref: null,
    winner_id: null,
    risk_level: slot.slot_type === 'timely' ? 'medium' : 'low',
    freshness_deadline: slot.slot_type === 'timely' ? formatIso(zonedDateFromLocal({ date, time: '23:59', timeZone: strategy.timezone })) : null,
    publish_payload: null,
  };
}

function candidateHook(type, topic) {
  const prefix = {
    extracted_insight: 'The mistake leaders keep making is thinking',
    decoder_ring: 'Most people are misreading what this story is actually about.',
    ritual_recipe: 'If your team keeps repeating the same failure, stop adding process.',
    archetype_diagnosis: 'You can tell a team is drifting into theater when',
    high_lindy_source_tour: 'An old idea becomes useful again when the present gets confusing.',
    cautionary_tale: 'A practice can look rigorous and still make the system worse.',
    from_the_mailbag: 'A note landed in my inbox that names a pattern I keep seeing.',
    short_story: 'A company can stay outwardly functional long after it has stopped telling itself the truth.',
  };
  return `${prefix[type.id]} ${topic.replace(/\.$/, '').toLowerCase()}.`;
}

function planBaselineWeek({ strategy, memory, context, watchlists = null, referenceDate = now() }) {
  const mailbagItems = loadMailbagItems();
  const types = listTypes()
    .filter((type) => strategy.content_types?.[type.id]?.enabled !== false);
  const usedTopics = new Set();
  const items = [];
  const plannedCounts = {};
  const plannedTypes = [];

  const slots = strategy.publishing?.baseline_slots || [];
  for (const [index, slot] of slots.entries()) {
    const date = localDateForWeekday({ from: referenceDate, weekday: slot.weekday, timeZone: strategy.timezone });
    const remainingSlots = slots.length - index - 1;
    const eligible = types.map((type) => {
      const typeConfig = strategy.content_types?.[type.id] || {};
      if (Array.isArray(typeConfig.weekdays) && !typeConfig.weekdays.includes(slot.weekday)) return null;
      const baseEligibility = type.isEligible({ strategy, memory, context, mailbagItems });
      if (!baseEligibility.eligible) return null;
      const provisional = {
        content_type: type.id,
        topic_thesis: '',
        angle: type.defaultAngle,
        hook: '',
        source_refs: [],
      };
      const memoryConflicts = getMemoryConflicts({ record: provisional, memory, strategy });
      if (memoryConflicts.includes('type_overuse')) return null;

      return {
        type,
        score:
          typeDeficitScore({
            typeId: type.id,
            strategy,
            memory,
            plannedCounts,
            plannedTotal: items.length,
          }) * 2
          + weeklyRotationScore({
            typeId: type.id,
            plannedTypes,
            remainingSlots,
          }),
      };
    }).filter(Boolean).sort((left, right) => (
      right.score - left.score
    )).map((entry) => entry.type);
    const pickedType = eligible[0] || types[0];
    const topicThesis = pickedType.requiresResearch
      ? selectResearchTopic({
        topics: strategy.topics || [],
        strategy,
        memory,
        context,
        watchlists: watchlists || { seed_topics: [], adjacent_domains: [], keyword_clusters: [], entities: {} },
      })
      : selectTopicForType({
        topics: strategy.topics || [],
        typeId: pickedType.id,
        strategy,
        memory,
        context,
        usedTopics,
      });
    usedTopics.add(normalizeText(topicThesis));
    const hook = candidateHook(pickedType, topicThesis);
    const angle = pickedType.defaultAngle;
    const calendarItem = buildCalendarItem({
      strategy,
      date,
      slot,
      type: pickedType,
      topicThesis,
      angle,
      hook,
    });
    items.push(calendarItem);
    plannedCounts[pickedType.id] = (plannedCounts[pickedType.id] || 0) + 1;
    plannedTypes.push(pickedType.id);
  }

  return {
    id: slugify(`week-${localDateForWeekday({ from: referenceDate, weekday: 'monday', timeZone: strategy.timezone })}`),
    generated_at: referenceDate.toISOString(),
    timezone: strategy.timezone,
    items,
  };
}

function selectTimelyCandidate({ strategy, memory, researchBundle, referenceDate = now() }) {
  if (!researchBundle || !Array.isArray(researchBundle.candidate_angles) || researchBundle.candidate_angles.length === 0) {
    return null;
  }

  const timelyTypes = listTypes().filter((type) => {
    const typeConfig = strategy.content_types?.[type.id] || {};
    return type.timelyEligible && typeConfig.enabled !== false && typeConfig.timely_eligible !== false;
  });

  for (const type of timelyTypes) {
    for (const slot of strategy.publishing?.timely_slots || []) {
      const topAngle = researchBundle.candidate_angles[0];
      const item = buildCalendarItem({
        strategy,
        date: localDateForWeekday({ from: referenceDate, weekday: slot.weekday, timeZone: strategy.timezone }),
        slot,
        type,
        topicThesis: topAngle.topic_thesis,
        angle: topAngle.angle,
        hook: topAngle.hook,
        researchBundleId: researchBundle.id,
        timelySubject: topAngle.subject,
      });
      const conflicts = getMemoryConflicts({
        record: {
          content_type: item.content_type,
          hook: item.hook,
          angle: item.angle,
          topic_thesis: item.topic_thesis,
          timely_subject: item.timely_subject,
          source_refs: (researchBundle.sources || []).map((source) => source.url),
        },
        memory,
        strategy,
      });
      if (conflicts.length === 0) return item;
    }
  }

  return null;
}

function calendarFileName({ calendarId }) {
  return path.join(paths.calendarDir, `${calendarId}.json`);
}

module.exports = {
  loadMailbagItems,
  planBaselineWeek,
  selectTimelyCandidate,
  calendarFileName,
  normalizeTopicEntry,
  scoreTopicCandidate,
  selectTopicForType,
  selectResearchTopic,
};
