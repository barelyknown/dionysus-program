const { sha256 } = require('./hash');

const DEFAULT_DIVIDER = '---';

function normalizeFooters(strategy) {
  return (strategy?.publishing?.linkedin_footer_options || [])
    .map((footer) => String(footer || '').trim())
    .filter(Boolean);
}

function footerDivider(strategy) {
  const divider = String(strategy?.publishing?.linkedin_footer_divider || '').trim();
  return divider || DEFAULT_DIVIDER;
}

function pickFooter({ strategy, calendarItem, winnerCandidate }) {
  const footers = normalizeFooters(strategy);
  if (footers.length === 0) {
    return {
      footer: '',
      index: null,
    };
  }

  const seed = [
    calendarItem?.id || '',
    calendarItem?.scheduled_at || '',
    winnerCandidate?.id || '',
    winnerCandidate?.post_text || '',
  ].join('|');
  const index = Number.parseInt(sha256(seed).slice(0, 8), 16) % footers.length;

  return {
    footer: footers[index],
    index,
  };
}

function buildLinkedInFinalText({ bodyText, footerText, divider = DEFAULT_DIVIDER }) {
  const body = String(bodyText || '').trim();
  const footer = String(footerText || '').trim();
  if (!footer) return body;
  return `${body}\n\n${divider}\n\n${footer}`;
}

module.exports = {
  normalizeFooters,
  footerDivider,
  pickFooter,
  buildLinkedInFinalText,
};
