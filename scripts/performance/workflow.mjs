// Run identical fixtures against two checkouts/servers. No real Supabase calls.
// node scripts/performance/workflow.mjs fixture.json 3000 before output.json
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { auth, user, sessionKey, historyFixture, installTransport } from './syntheticTransport.mjs';

const [fixturePath, port='3000', variant='current', output='/tmp/annaba-workflow.json'] = process.argv.slice(2);
const base = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const scenarios = (process.env.ANNABA_SCENARIOS || 'login,direct,complete').split(',');
const samples = Number(process.env.ANNABA_SAMPLES || 2);
const results = [];
const total = (calls) => ({ requests: calls.length, rows: calls.reduce((n,c) => n+c.rows,0),
  jsonBytes: calls.reduce((n,c) => n+c.bytes,0), calls });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  for (const history of [1000,10000]) for (const scenario of scenarios) for (let sample=0; sample<samples; sample++) {
    const context = await browser.newContext({ viewport: { width:1280,height:900 }, locale:'fr-FR', timezoneId:'UTC', serviceWorkers:'block' });
    const calls=[], writes=[];
    const result = { variant, history, scenario, sample, browser: browser.version(), stages: [], errors: [] };
    results.push(result);
    try {
      await context.addInitScript(({auth,key,scenario}) => {
        if (scenario !== 'login') localStorage.setItem(key, JSON.stringify(auth));
      }, { auth, key:sessionKey, scenario });
      await installTransport(context, historyFixture(base,history), calls, writes);
      const page = await context.newPage();
      page.on('pageerror', (error) => result.errors.push(error.message.slice(0,200)));
      const usable = async () => {
        const path = new URL(page.url()).pathname;
        const title = path.startsWith('/students') ? 'Étudiants' : path === '/attendance' ? 'Présences' : path === '/cash' ? 'Caisse' : null;
        if (title) await page.getByRole('heading', { name:title,exact:true }).waitFor({timeout:120000});
        await page.waitForFunction(() => document.querySelector('main input') && !document.querySelector('.revalidate-bar'), null, { timeout:120000 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      };
      const stage = async (name, action) => {
        const from = calls.length, writeFrom = writes.length, start = performance.now();
        await action(); await usable();
        const usableMs = performance.now()-start;
        const foregroundEnd = calls.length;
        // Observation only, never used as the screen-readiness condition.
        await page.waitForTimeout(1200);
        const cardTexts = await page.locator('main div.group.relative').allTextContents();
        result.stages.push({ name, usableMs, foreground:total(calls.slice(from,foregroundEnd)),
          background:total(calls.slice(foregroundEnd)), writes:writes.slice(writeFrom),
          cards:cardTexts.length,
          cardTextDigest:cardTexts.length ? createHash('sha256').update(cardTexts.map((v) => v.replace(/\s+/g,' ').trim()).join('\n')).digest('hex') : null,
          filterCounts:await page.locator('main button').allTextContents().then((texts) => texts.map((v) => v.replace(/\s+/g,' ').trim()).filter((v) => /^(Tous|En dette|Solde faible|À jour|Cas spéciaux)\s*\d/.test(v))),
        });
      };
      if (scenario === 'login') {
        await stage('normal login → Dashboard', async () => {
          await page.goto(`http://localhost:${port}/login`, { waitUntil:'domcontentloaded' });
          await page.waitForFunction(() => {
            const form=document.querySelector('form');
            return form && Object.keys(form).some((key) => key.startsWith('__reactProps$'));
          });
          await page.locator('input[type=email]').fill(user.email);
          await page.locator('input[type=password]').fill('synthetic-password');
          await page.getByRole('button', { name:'Se connecter',exact:true }).click();
          await page.waitForURL('**/dashboard', { waitUntil:'domcontentloaded',timeout:120000 });
        });
        for (const [path,name] of [['students','Étudiants'],['attendance','Attendance'],['cash','Caisse']]) {
          await stage(`one sidebar click → ${name}`, async () => {
            await page.locator(`nav a[href="/${path}"]:visible`).first().click();
            await page.waitForURL(`**/${path}`, { waitUntil:'domcontentloaded',timeout:120000 });
          });
          if (path === 'students') {
            await stage('Students search', async () => { await page.locator('main input').first().fill('Nom400'); });
            await stage('Students clear search', async () => { await page.locator('main input').first().fill(''); });
            await stage('Students debt filter', async () => { await page.getByRole('button',{name:/En dette/}).first().click(); });
          }
        }
      } else {
        const path = scenario === 'complete' ? '/students/complete' : '/students';
        await stage(`direct ${path}`, () => page.goto(`http://localhost:${port}${path}`, { waitUntil:'domcontentloaded' }));
        await stage(`refresh ${path}`, () => page.reload({ waitUntil:'domcontentloaded' }));
      }
      // Poll the active scope with fake time, not a 46-second real-time wait.
      await stage('46-second background polling window', async () => {
        await page.clock.install(); await page.clock.fastForward(46000); await page.clock.resume();
      });
      result.total = total(calls); result.writes = writes;
      console.log(JSON.stringify({variant,history,scenario,sample,requests:calls.length,rows:result.total.rows,jsonBytes:result.total.jsonBytes,writes:writes.length}));
    } catch (error) {
      result.failure = error.message; result.total=total(calls); result.writes=writes; process.exitCode=1;
      console.error(JSON.stringify({history,scenario,sample,failure:error.message}));
    } finally {
      await context.close();
      fs.writeFileSync(output,JSON.stringify({fixture:fixturePath,network:'local intercepted synthetic; no latency/CPU shaping; no production calls',results},null,2));
    }
  }
} finally { await browser.close(); }
