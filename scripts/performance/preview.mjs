// A separate, disposable browser context with every remote call intercepted.
// Closing this window discards its session, IndexedDB and rejected write queue.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { auth, sessionKey, historyFixture, installTransport } from './syntheticTransport.mjs';

const [fixturePath, port='3000', history='1000'] = process.argv.slice(2);
if (!fixturePath || !['1000','10000'].includes(history)) throw new Error('Usage: node scripts/performance/preview.mjs fixture.json [port] [1000|10000]');
const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH || undefined, headless:false });
try {
  const context = await browser.newContext({ viewport:{width:1440,height:1000}, locale:'fr-FR', timezoneId:'UTC', serviceWorkers:'block' });
  await context.addInitScript(({auth,key}) => localStorage.setItem(key,JSON.stringify(auth)), {auth,key:sessionKey});
  await installTransport(context, historyFixture(JSON.parse(fs.readFileSync(fixturePath,'utf8')),Number(history)), [], []);
  const page=await context.newPage();
  await page.goto(`http://localhost:${port}/dashboard`, {waitUntil:'domcontentloaded'});
  console.log('Synthetic preview: Dashboard → Étudiants → Attendance → Caisse. All database writes are rejected. Close the window to exit.');
  await page.waitForEvent('close',{timeout:0});
} finally { await browser.close(); }
