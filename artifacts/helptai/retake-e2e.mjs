import { chromium } from 'playwright-core'; import fs from 'node:fs';
const S = process.env.S; const docApi = fs.readFileSync(`${S}/lay-notes-api.json`, 'utf8');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route('**/api/process-document', r => r.fulfill({ status: 200, contentType: 'application/json', body: docApi }));
let mode = 'error', calls = [];
await p.route('**/api/process-page', async r => {
  const body = JSON.parse(r.request().postData()); calls.push({ mode, pageNumber: body.pageNumber, bytes: body.dataUrl.length });
  if (calls.length === 1) fs.writeFileSync(`${S}/retake-sent.txt`, body.dataUrl.split(',')[1], 'base64');
  if (mode === 'error') return r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: "Gemini's usage limit has been reached for now. Please try again a little later.", code: 'quota' }) });
  const poor = mode === 'poor';
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ page: { pageNumber: body.pageNumber, title: 'Retaken page', text: 'RETAKEN TEXT line one\nline two', confidence: poor ? 0.5 : 0.96, needsReview: poor, reviewReason: poor ? 'Still blurry near the bottom.' : null, sourceFrameIndices: [0], bestFrameIndex: 0, pageBox: null, blocks: [{ type: 'paragraph', text: 'RETAKEN TEXT line one line two', box: [100, 100, 300, 900] }] }, usage: { model: 'm', inputTokens: 1, outputTokens: 1, thinkingTokens: 0 } }) });
});
await p.goto('http://localhost:5173/'); await p.setInputFiles('[data-testid="input-video-file"]', '/home/hadi/App_developing/helptai/handwriting.mp4');
await p.waitForSelector('[data-testid="view-frame-review"]', { timeout: 120000 }); await p.click('[data-testid="button-continue-frame-review"]');
await p.waitForSelector('[data-testid="view-review"]', { timeout: 60000 });
const ok = (name, cond, extra = '') => console.log(cond ? 'PASS' : 'FAIL', name, extra);
const pagesBefore = await p.locator('.thumb').count();
ok('review shows pages', pagesBefore === 8, String(pagesBefore));

// Retake page 2 (not flagged: the retake button works on any page)
await p.click('[data-testid="thumbnail-page-2"]'); await p.click('[data-testid="button-retake-selected"]');
await p.waitForSelector('[data-testid="view-patch"]'); ok('patch view opens for page 2', (await p.locator('h1').innerText()).includes('page 02'));
await p.setInputFiles('[data-testid="input-patch-file"]', `${S}/retake-big.jpg`);
await p.waitForSelector('[data-testid="img-patch-photo"]');

// 1) error path
await p.click('[data-testid="button-apply-patch"]');
await p.waitForSelector('[data-testid="text-patch-error"]');
ok('error shown calmly, still on patch view', (await p.locator('[data-testid="text-patch-error"]').innerText()).includes('usage limit') && await p.locator('[data-testid="view-patch"]').count() === 1);
ok('photo kept for retry', await p.locator('[data-testid="img-patch-photo"]').count() === 1);
ok('button now offers retry', (await p.locator('[data-testid="button-apply-patch"]').innerText()).includes('try this photo again'));

// 2) still-poor path
mode = 'poor'; await p.click('[data-testid="button-apply-patch"]');
await p.waitForSelector('[data-testid="view-review"]');
let toast = await p.locator('[data-testid="status-toast"]').innerText();
ok('poor retake: amber message', toast.includes('still a little hard to read'), toast);
ok('page 2 stays flagged with new reason', (await p.locator('[data-testid="flagged-page-2"]').innerText()).includes('Still blurry near the bottom.'));
ok('flag button offers another photo', (await p.locator('[data-testid="button-patch-page-2"]').innerText()).includes('try another photo'));

// 3) good retake from the flag card
mode = 'good'; await p.click('[data-testid="button-patch-page-2"]'); await p.waitForSelector('[data-testid="view-patch"]');
await p.setInputFiles('[data-testid="input-patch-file"]', `${S}/retake-big.jpg`); await p.waitForSelector('[data-testid="img-patch-photo"]');
await p.click('[data-testid="button-apply-patch"]'); await p.waitForSelector('[data-testid="view-review"]');
toast = await p.locator('[data-testid="status-toast"]').innerText();
ok('good retake: green message', toast.includes('has been refreshed'), toast);
ok('flag cleared', await p.locator('[data-testid="flagged-page-2"]').count() === 0);
ok('summary says retaken', (await p.locator('[data-testid="card-flagged-page"]').innerText()).includes('page 02'));
ok('page 2 shows the new text', (await p.locator('[data-testid="page-replica"]').innerText()).includes('RETAKEN TEXT'));
ok('sheet marked retaken', (await p.locator('.sheet-topline').innerText()).includes('retaken'));
ok('other page untouched', await (async () => { await p.click('[data-testid="thumbnail-page-3"]'); return !(await p.locator('[data-testid="page-replica"]').innerText()).includes('RETAKEN'); })());
console.log('requests', JSON.stringify(calls));

// exports contain the retaken page
await p.click('[data-testid="thumbnail-page-2"]');
for (const f of ['pdf', 'word', 'powerpoint']) { const [d] = await Promise.all([p.waitForEvent('download'), p.click(`[data-testid="button-export-${f}"]`)]); await d.saveAs(`${S}/out/retake-${f}`); }
console.log('errors', errs); await b.close();
