const path = require('path');
const { readJson, writeJson, listFiles } = require('./fs');
const { paths } = require('./paths');

function loadCalendarFiles() {
  return listFiles(paths.calendarDir, (filePath) => filePath.endsWith('.json'));
}

function loadCalendars() {
  return loadCalendarFiles().map((filePath) => ({
    filePath,
    data: readJson(filePath, { items: [] }),
  }));
}

function saveCalendar(filePath, calendar) {
  writeJson(filePath, calendar);
}

function findCalendarItem(itemId) {
  for (const calendar of loadCalendars()) {
    const item = (calendar.data.items || []).find((entry) => entry.id === itemId);
    if (item) {
      return {
        filePath: calendar.filePath,
        calendar: calendar.data,
        item,
      };
    }
  }
  return null;
}

function replaceCalendarItem(calendar, nextItem) {
  return {
    ...calendar,
    items: (calendar.items || []).map((item) => (item.id === nextItem.id ? nextItem : item)),
  };
}

function runFilePath(runId) {
  return path.join(paths.runsDir, `${runId}.json`);
}

module.exports = {
  loadCalendars,
  saveCalendar,
  findCalendarItem,
  replaceCalendarItem,
  runFilePath,
};

