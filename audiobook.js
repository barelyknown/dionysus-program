/* Chapter playback with per-edition progress. No audio prefetch or autoplay. */
(function (global) {
  'use strict';
  function validPosition(value, chapters) {
    if (!value || !Number.isInteger(value.chapter) || value.chapter < 0 || value.chapter >= chapters.length) return null;
    if (!Number.isFinite(value.time) || value.time < 0 || value.time > chapters[value.chapter].duration_seconds + 1) return null;
    return {chapter:value.chapter, time:value.time, speed:[.75, 1, 1.25, 1.5, 1.75, 2].includes(value.speed) ? value.speed : 1};
  }
  function positionAt(seconds, chapters) {
    let time = Math.max(0, seconds);
    for (let i = 0; i < chapters.length; i++) {
      if (time < chapters[i].duration_seconds || i === chapters.length - 1) return {chapter:i, time:Math.min(time, chapters[i].duration_seconds)};
      time -= chapters[i].duration_seconds;
    }
    return {chapter:0, time:0};
  }
  function timestamp(seconds) {
    const n = Math.max(0, Math.floor(seconds));
    return Math.floor(n / 3600) + ':' + String(Math.floor(n / 60) % 60).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  }
  if (typeof module !== 'undefined') module.exports = {validPosition, positionAt, timestamp};
  if (typeof document === 'undefined') return;
  const data = document.getElementById('audiobook-data');
  if (!data) return;
  const book = JSON.parse(data.textContent);
  const audio = document.getElementById('book-audio');
  const select = document.getElementById('chapter');
  const speed = document.getElementById('speed');
  const status = document.getElementById('player-status');
  const resume = document.getElementById('resume');
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  const key = 'dionysus-audiobook:' + book.edition;
  let index = 0, pendingTime = null, lastSave = 0;
  let saved = null;
  try { saved = validPosition(JSON.parse(localStorage.getItem(key)), book.chapters); } catch (_) { /* Private browsing can disable storage. */ }
  function currentTime() { return pendingTime === null ? audio.currentTime : pendingTime; }
  function absoluteTime() {
    return book.chapters.slice(0, index).reduce((sum, c) => sum + c.duration_seconds, 0) + currentTime();
  }
  function update() {
    document.getElementById('progress').textContent = 'Chapter ' + (index + 1) + ' of ' + book.chapters.length + ' · ' + timestamp(absoluteTime()) + ' / ' + timestamp(book.duration_seconds);
  }
  function save() {
    try { localStorage.setItem(key, JSON.stringify({chapter:index, time:currentTime(), speed:audio.playbackRate})); } catch (_) { /* Playback works without storage. */ }
  }
  function play() {
    resume.hidden = true;
    audio.play().catch(() => { status.textContent = 'Press play to continue listening.'; });
  }
  function setChapter(number, time = 0, playing = false) {
    index = Math.max(0, Math.min(book.chapters.length - 1, number));
    pendingTime = time;
    select.value = String(index);
    audio.src = book.chapters[index].url;
    audio.playbackRate = Number(speed.value);
    document.getElementById('now-playing').textContent = book.chapters[index].title;
    previous.disabled = index === 0;
    next.disabled = index === book.chapters.length - 1;
    status.textContent = 'Your place is saved in this browser. Chapters play in order.';
    update();
    if (playing) play();
  }
  function seekBy(delta) {
    const target = positionAt(absoluteTime() + delta, book.chapters);
    if (target.chapter !== index) setChapter(target.chapter, target.time, !audio.paused);
    else {
      pendingTime = target.time;
      if (audio.readyState >= 1) { audio.currentTime = target.time; pendingTime = null; }
      update();
    }
    save();
  }
  audio.addEventListener('loadedmetadata', () => {
    if (pendingTime !== null) {
      audio.currentTime = Math.min(pendingTime, Math.max(0, audio.duration - .05));
      pendingTime = null;
    }
    audio.playbackRate = Number(speed.value);
    update();
  });
  audio.addEventListener('timeupdate', () => {
    update();
    if (Date.now() - lastSave > 3000) { save(); lastSave = Date.now(); }
  });
  audio.addEventListener('pause', save);
  audio.addEventListener('play', () => { resume.hidden = true; });
  audio.addEventListener('ended', () => {
    if (index + 1 < book.chapters.length) { setChapter(index + 1, 0, true); save(); }
    else { status.textContent = 'You’ve reached the end of the audiobook.'; save(); }
  });
  audio.addEventListener('error', () => { status.textContent = 'This chapter couldn’t be loaded. Try again, or download the audiobook below.'; });
  select.addEventListener('change', () => { setChapter(Number(select.value), 0, !audio.paused); save(); });
  previous.addEventListener('click', () => { setChapter(index - 1, 0, !audio.paused); save(); });
  next.addEventListener('click', () => { setChapter(index + 1, 0, !audio.paused); save(); });
  document.getElementById('back').addEventListener('click', () => seekBy(-30));
  document.getElementById('forward').addEventListener('click', () => seekBy(30));
  speed.addEventListener('change', () => { audio.playbackRate = Number(speed.value); save(); });
  resume.addEventListener('click', play);
  global.addEventListener('pagehide', save);
  if (saved) speed.value = String(saved.speed);
  setChapter(saved ? saved.chapter : 0, saved ? saved.time : 0);
  if (saved && absoluteTime() > 5) {
    resume.hidden = false;
    resume.textContent = 'Resume chapter ' + (index + 1) + ' at ' + timestamp(saved.time);
  }
  if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
    navigator.mediaSession.metadata = new MediaMetadata({title:book.title, artist:book.author, album:book.subtitle, artwork:[{src:new URL('../assets/audiobook/cover.jpg', global.location.href).href, sizes:'1000x1000', type:'image/jpeg'}]});
    for (const [action, handler] of Object.entries({previoustrack:() => previous.click(), nexttrack:() => next.click(), seekbackward:() => seekBy(-30), seekforward:() => seekBy(30)})) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) { /* Not all browsers support every action. */ }
    }
  }
})(typeof window === 'undefined' ? globalThis : window);
