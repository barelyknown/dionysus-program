function pad(number) {
  return String(number).padStart(2, '0');
}

function getTimeZoneOffsetMinutes(timeZone, date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const zone = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  const match = zone.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  return sign * ((hours * 60) + minutes);
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: String(parts.weekday || '').toLowerCase(),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function zonedDateFromLocal({ date, time, timeZone }) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 2; i += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, new Date(utcMs));
    utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - (offsetMinutes * 60 * 1000);
  }
  return new Date(utcMs);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfLocalDay(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return zonedDateFromLocal({ date: parts.date, time: '00:00', timeZone });
}

function formatIso(date) {
  return date.toISOString();
}

function weekdayIndex(weekday) {
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(weekday);
}

function nextWeekdayDate({ from, weekday, timeZone }) {
  const localStart = startOfLocalDay(from, timeZone);
  const current = zonedParts(localStart, timeZone);
  const currentIndex = weekdayIndex(current.weekday);
  const targetIndex = weekdayIndex(weekday);
  let delta = targetIndex - currentIndex;
  if (delta <= 0) delta += 7;
  const next = addDays(localStart, delta);
  return zonedParts(next, timeZone).date;
}

function dateDiffInDays(later, earlier) {
  return Math.floor((later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000));
}

function now() {
  return new Date();
}

function localDateForWeekday({ from, weekday, timeZone, includeToday = false }) {
  const localParts = zonedParts(from, timeZone);
  const fromIndex = weekdayIndex(localParts.weekday);
  const targetIndex = weekdayIndex(weekday);
  let delta = targetIndex - fromIndex;
  if (delta < 0 || (!includeToday && delta === 0)) delta += 7;
  const start = startOfLocalDay(from, timeZone);
  return zonedParts(addDays(start, delta), timeZone).date;
}

module.exports = {
  pad,
  zonedParts,
  zonedDateFromLocal,
  addDays,
  startOfLocalDay,
  formatIso,
  weekdayIndex,
  nextWeekdayDate,
  dateDiffInDays,
  now,
  localDateForWeekday,
  getTimeZoneOffsetMinutes,
};

