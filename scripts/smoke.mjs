// End-to-end smoke test: launches the real app, opens a page, highlights a passage,
// asks for an explanation and checks that text streams back from Token Factory.
//   node scripts/smoke.mjs [url]
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'https://en.wikipedia.org/wiki/Speculative_execution';
const shots = process.env.SHOTS_DIR || path.join(root, '.smoke');
mkdirSync(shots, { recursive: true });

const app = await electron.launch({
  args: [root],
  env: { ...process.env, COMPANION_USER_DATA: mkdtempSync(path.join(tmpdir(), 'rc-smoke-')) },
});
const fail = async (message) => {
  console.error(`FAIL: ${message}`);
  await app.close();
  process.exit(1);
};

const win = await app.firstWindow();
win.on('console', (msg) => msg.type() === 'error' && console.log('[shell error]', msg.text()));
win.on('pageerror', (err) => console.log('[shell exception]', err.message));
await win.waitForSelector('#home-url');
await win.screenshot({ path: path.join(shots, '1-home.png') });

await win.fill('#home-url', url);
await win.press('#home-url', 'Enter');
await win.waitForFunction(() => document.body.classList.contains('loaded'), null, { timeout: 45000 });
await win.waitForTimeout(1200);

// Select the first substantial paragraph inside the page, the way a reader would.
const selected = await win.evaluate(() => document.querySelector('.view.active').executeJavaScript(`(() => {
  const p = Array.from(document.querySelectorAll('#mw-content-text p, article p, main p, p')).find((el) => el.innerText.trim().length > 160 && el.getBoundingClientRect().height > 0);
  if (!p) return '';
  p.scrollIntoView({ block: 'center' });
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  return sel.toString().slice(0, 80);
})()`));
if (!selected) await fail('no paragraph found to select');
console.log('selected:', selected);

await win.waitForSelector('#pill:not([hidden])', { timeout: 5000 }).catch(() => fail('selection pill never appeared'));
await win.waitForTimeout(700);
await win.screenshot({ path: path.join(shots, '2-pill.png') });

await win.click('#pill [data-action="explain"]');
await win.waitForSelector('#bubble:not([hidden])');
await win.waitForFunction(() => document.querySelector('#bubble-body .msg-bot, #bubble-body .msg-note')?.innerText.trim().length > 40, null, { timeout: 60000 })
  .catch(() => fail('no answer text arrived'));
await win.screenshot({ path: path.join(shots, '3-streaming.png') });
await win.waitForFunction(() => document.querySelector('#bubble-chips').children.length > 0 || document.querySelector('.msg-note'), null, { timeout: 60000 });
await win.waitForTimeout(400);
await win.screenshot({ path: path.join(shots, '4-answer.png') });

const note = await win.evaluate(() => document.querySelector('#bubble-body .msg-note')?.innerText || '');
const answer = await win.evaluate(() => document.querySelector('#bubble-body .msg-bot')?.innerText || '');
if (note) await fail(`the app reported: ${note}`);
console.log(`answer (${answer.length} chars): ${answer.slice(0, 160).replace(/\s+/g, ' ')}...`);
console.log(`PASS. Screenshots in ${shots}`);
await app.close();
