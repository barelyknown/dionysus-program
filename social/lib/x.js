const { sha256 } = require('./hash');
const { charCount } = require('../providers/gpt-x');

function rankXResults({ scorecards, candidates }) {
  const byCandidateId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return [...scorecards].sort((left, right) => {
    if (Boolean(left.pass) !== Boolean(right.pass)) return left.pass ? -1 : 1;
    if (left.overall_score !== right.overall_score) return right.overall_score - left.overall_score;

    const leftCandidate = byCandidateId.get(left.candidate_id);
    const rightCandidate = byCandidateId.get(right.candidate_id);
    return charCount(leftCandidate?.post_text || '') - charCount(rightCandidate?.post_text || '');
  });
}

function buildXPublishPayload({ linkedinPayload, winnerCandidate, winnerScore }) {
  return {
    source_channel: 'linkedin',
    source_final_text_hash: sha256(linkedinPayload.final_text),
    source_winning_candidate_id: linkedinPayload.winning_candidate_id,
    text: winnerCandidate.post_text,
    winning_candidate_id: winnerCandidate.id,
    winning_score: winnerScore.overall_score,
  };
}

async function attemptXPublish({ linkedinPayload, strategy, adapters, dryRun = false }) {
  if (strategy?.x?.enabled === false) {
    return {
      status: 'disabled',
      reason: 'x_disabled',
    };
  }

  try {
    const sourceText = linkedinPayload.body_text || linkedinPayload.final_text;
    const candidates = await adapters.xWriter.generateCandidates({
      linkedinText: sourceText,
      strategy,
      bestOfN: Number(strategy?.x?.best_of_n || 8),
    });
    const scorecards = await adapters.xScorer.scoreCandidates({
      candidates,
      linkedinText: sourceText,
      strategy,
    });
    const ranked = rankXResults({ scorecards, candidates });
    const winnerScore = ranked.find((entry) => entry.pass) || null;
    const winnerCandidate = winnerScore
      ? candidates.find((candidate) => candidate.id === winnerScore.candidate_id) || null
      : null;

    if (!winnerCandidate || !winnerScore) {
      return {
        status: 'skipped',
        reason: 'no_passing_candidate',
        candidates,
        scorecards,
      };
    }

    const payload = buildXPublishPayload({
      linkedinPayload,
      winnerCandidate,
      winnerScore,
    });

    if (dryRun) {
      return {
        status: 'dry_run',
        payload,
        candidates,
        scorecards,
        winnerCandidate,
        winnerScore,
      };
    }

    try {
      const publishResult = await adapters.x.publish({ payload });
      return {
        status: 'published',
        payload,
        candidates,
        scorecards,
        winnerCandidate,
        winnerScore,
        publishResult,
      };
    } catch (error) {
      return {
        status: 'failed',
        reason: 'publish_failed',
        error: error.message,
        payload,
        candidates,
        scorecards,
        winnerCandidate,
        winnerScore,
      };
    }
  } catch (error) {
    return {
      status: 'failed',
      reason: 'generation_or_scoring_failed',
      error: error.message,
    };
  }
}

module.exports = {
  rankXResults,
  buildXPublishPayload,
  attemptXPublish,
};
