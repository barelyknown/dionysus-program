const {test, expect} = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
test.use({video:'off', trace:'off'});
// Synthetic silent WAV verifies native media controls without loading the unpublished book.
function silentWav(seconds = 120) {
  const dataBytes = seconds * 8000 * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(dataBytes, 40); return wav;
}
test.beforeEach(async ({page}) => {
  await page.route('https://cloud.umami.is/**', route => route.abort());
  await page.route('https://github.com/**', route => {
    const data = silentWav();
    const match = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Math.min(Number(match[2]), data.length-1) : data.length-1;
    const headers = {'accept-ranges':'bytes', 'content-length':String(end-start+1)};
    if (match) headers['content-range'] = `bytes ${start}-${end}/${data.length}`;
    return route.fulfill({status:match ? 206 : 200, contentType:'audio/wav', headers, body:data.subarray(start,end+1)});
  });
});
test('player is quiet on load, remembers progress and advances chapters', async ({page}) => {
  let requested = 0;
  page.on('request', request => { if (request.url().startsWith('https://github.com/')) requested++; });
  await page.goto('/audiobook/');
  await expect(page.locator('#chapter option')).toHaveCount(92);
  expect(requested).toBe(0);
  await expect(page.locator('#previous')).toBeDisabled();
  await page.locator('#chapter').selectOption('5');
  await expect(page.locator('#now-playing')).toHaveText('Preface');
  expect(requested).toBe(0);
  await page.locator('#book-audio').evaluate(audio => audio.play());
  await expect.poll(() => page.locator('#book-audio').evaluate(audio => audio.paused)).toBe(false);
  await page.locator('#speed').selectOption('1.5');
  await page.locator('#forward').click();
  await expect.poll(() => page.locator('#book-audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(29);
  await page.locator('#book-audio').evaluate(audio => audio.pause());
  await page.reload();
  await expect(page.locator('#resume')).toBeVisible();
  await expect(page.locator('#chapter')).toHaveValue('5');
  await expect(page.locator('#speed')).toHaveValue('1.5');
  await page.locator('#resume').click();
  await expect.poll(() => page.locator('#book-audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(29);
  await page.locator('#book-audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
  await expect(page.locator('#chapter')).toHaveValue('6');
  await expect.poll(() => page.locator('#book-audio').evaluate(audio => audio.paused)).toBe(false);
});
test('mobile layout, accessible controls and download fallback', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/audiobook/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('link', {name:'M4B audiobook', exact:false})).toHaveAttribute('href', /dionysus-program\.m4b$/);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.screenshot({path:'playwright-artifacts/audiobook-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:'playwright-artifacts/audiobook-desktop.png',fullPage:true});
});
test('download links remain usable without JavaScript', async ({browser, baseURL}) => {
  const context = await browser.newContext({javaScriptEnabled:false});
  const page = await context.newPage();
  await page.route('https://**', route => route.abort());
  await page.goto(baseURL+'/audiobook/', {waitUntil:'domcontentloaded'});
  await expect(page.locator('#now-playing')).toBeEmpty();
  await expect(page.getByRole('link', {name:'MP3 chapters',exact:false})).toHaveAttribute('href', /dionysus-program-mp3\.zip$/);
  await context.close();
});
