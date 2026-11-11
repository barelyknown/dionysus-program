const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {validPosition, positionAt, timestamp} = require('../audiobook.js');
const chapters = [{duration_seconds:60}, {duration_seconds:90}];
test('saved positions cannot select missing chapters or invalid timestamps', () => {
  for (const state of [null, {}, {chapter:2,time:0}, {chapter:0,time:-1}, {chapter:0,time:Infinity}, {chapter:0,time:900}]) assert.equal(validPosition(state, chapters), null);
  assert.deepEqual(validPosition({chapter:1,time:24,speed:1.5}, chapters), {chapter:1,time:24,speed:1.5});
  assert.equal(validPosition({chapter:0,time:0,speed:900}, chapters).speed, 1);
});
test('skip controls cross chapters and clamp the book boundaries', () => {
  assert.deepEqual(positionAt(-30, chapters), {chapter:0,time:0});
  assert.deepEqual(positionAt(60, chapters), {chapter:1,time:0});
  assert.deepEqual(positionAt(85, chapters), {chapter:1,time:25});
  assert.deepEqual(positionAt(200, chapters), {chapter:1,time:90});
  assert.equal(timestamp(33088.88), '9:11:28');
});
test('published chapter map is complete and contiguous', () => {
  const book = JSON.parse(fs.readFileSync(new URL('../content/audiobook.json', `file://${__filename}`), 'utf8'));
  assert.equal(book.chapters.length, 92);
  let end = 0;
  book.chapters.forEach((chapter, i) => {
    assert.equal(chapter.number, i + 1);
    assert.ok(Math.abs(chapter.start_seconds - end) < .001);
    assert.ok(chapter.url.endsWith(encodeURI(chapter.file)));
    end += chapter.duration_seconds;
  });
  assert.ok(Math.abs(book.duration_seconds - end) < .1);
});
