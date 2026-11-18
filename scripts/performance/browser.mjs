/* Synthetic only. Intercepts EVERY non-local request; never contacts Supabase.
 * Usage: node scripts/performance/browser.mjs /tmp/annaba-synthetic-base.json 3000 current /tmp/current.json */
import fs from 'node:fs';
import { chromium } from 'playwright';
const [fixturePath, port = '3000', variant = 'current', output = '/tmp/annaba-browser.json'] = process.argv.slice(2);
const entry = process.env.ANNABA_ENTRY || 'students';
const base = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const uid = '00000000-0000-4000-8000-000000000001';
const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { role: 'reception', full_name: 'Synthetic Desk' },
  created_at: '2026-01-01T00:00:00.000Z' };
const jwt = `e30.${Buffer.from(JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.synthetic`;
const auth = { access_token: jwt, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now()/1000)+3600, user };
const sessionKey = 'altech-school-auth-nxbdvyfmtksknbvfcfdk';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const [history, roster] of (process.env.ANNABA_EXTENDED === "1" ? [[1000,500],[10000,500]] : [[1000,500],[10000,500],[1000,5000]])) {
      for (let sample=0;sample<2;sample++) {
        const data = structuredClone(base);
        if (roster > 500) for (let i=500;i<roster;i++) data.students.push({ ...data.students[0], id: `large-${i}`, first_name: `Large${i}`, last_name: `Roster${i}`, subscription_ids: [], subscription_dates: {}, rfid: `LARGE-${i}` });
        for (const table of ['attendance_records','payments','teacher_payments']) {
          const model = data[table]?.[0] || { id: 'model' };
          data[table] ||= [];
          for (let i=0;i<history;i++) data[table].push({ ...model, id:`history-${i}`, student_id:'synthetic-00499', session_id:'archived-unrelated', subscription_id:'archived-unrelated', occurred_at:'2025-01-01T12:00:00.000Z', date:'2025-01-01' });
        }
        const context = await browser.newContext({ viewport:{ width:1280,height:900 }, locale:'fr-FR', timezoneId:'UTC' });
        const calls=[]; const writes=[];
        await context.addInitScript(({auth,key,entry}) => {
          if (entry !== "login" && !localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(auth));
          window.__longTasks = { count:0, ms:0 };
          new PerformanceObserver((entries)=> { for(const e of entries.getEntries()) { window.__longTasks.count++;window.__longTasks.ms+=e.duration; } }).observe({ type:'longtask',buffered:true });
        }, {auth,key:sessionKey,entry});
        await context.route('**/*', async (route) => {
          const request=route.request(); const url=new URL(request.url());
          if (url.hostname==='127.0.0.1' || url.hostname==='localhost') return route.continue();
          if (!url.hostname.endsWith('.supabase.co')) return route.abort();
          if(url.pathname.startsWith('/auth/')) return route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify(url.pathname.endsWith('/user')?user:auth) });
          const table=url.pathname.split('/').pop();
          if (!['GET','HEAD'].includes(request.method()) && !url.pathname.includes('/rpc/admin_exists')) { writes.push(table); return route.fulfill({status:409,contentType:'application/json',body:'{"message":"Synthetic benchmark rejects mutations"}'}); }
          let rows = table==='profiles' ? [{ id:uid, role:'reception', entity_id:uid, full_name:'Synthetic Desk', email:user.email }] : structuredClone(data[table] || []);
          if (table==='reception_staff') rows = [{ id:uid, first_name:'Synthetic',last_name:'Desk' }];
          for (const [column,expr] of url.searchParams) {
            if(expr.startsWith('eq.')) rows=rows.filter((r)=>String(r[column])===expr.slice(3));
            if(expr.startsWith('gte.')) rows=rows.filter((r)=>String(r[column])>=expr.slice(4));
            if(expr.startsWith('lt.')) rows=rows.filter((r)=>String(r[column])<expr.slice(3));
          }
          if (table==='students' && url.searchParams.has('or')) {
            const query=url.searchParams.getAll('or').join('');
            if(query.includes('Nom400')) rows=rows.filter((r)=>r.last_name==='Nom400');
          }
          const count=rows.length;
          const offset=Number(url.searchParams.get('offset')||0), limit=Number(url.searchParams.get('limit')||1000);
          if (url.searchParams.get('order')) {
            const fields=url.searchParams.get('order').split(',').map((v)=>v.split('.')[0]);
            rows.sort((a,b)=> { for(const field of fields){const c=String(a[field]||'').localeCompare(String(b[field]||''));if(c)return c;}return 0;});
          }
          rows=rows.slice(offset,offset+limit);
          const select=url.searchParams.get('select');
          if(select && select!=='*') rows=rows.map((row)=>Object.fromEntries(select.split(',').map((k)=>[k,row[k]??null])));
          let body=JSON.stringify(request.headers().accept?.includes('vnd.pgrst.object') ? rows[0]||null : rows);
          if(url.pathname.includes('/rpc/admin_exists')) body='true';
          calls.push({table,rows:rows.length,bytes:Buffer.byteLength(body),method:request.method()});
          await route.fulfill({ status:200,contentType:'application/json',body,headers:{ 'content-range':`${offset}-${Math.max(offset,offset+rows.length-1)}/${count}`, 'access-control-expose-headers':'content-range' } });
        });
        const page=await context.newPage();
        page.on("pageerror", (error) => console.error(error.message.slice(0,200).replace(/eyJ[^ ]+/g,"[redacted]")));
        const cdp=await context.newCDPSession(page); await cdp.send('Performance.enable');
        await cdp.send('Network.enable'); const localRequests = new Set(); let staticBytes=0;
        cdp.on('Network.requestWillBeSent',(event)=> { const u=new URL(event.request.url); if((u.hostname==='localhost'||u.hostname==='127.0.0.1') && u.pathname.startsWith('/_next/')) localRequests.add(event.requestId); });
        cdp.on('Network.loadingFinished',(event)=> { if(localRequests.has(event.requestId)) staticBytes+=event.encodedDataLength; });
        const start=performance.now();
        await page.goto(`http://localhost:${port}/${entry === "login" ? "login" : "students"}`,{waitUntil:'domcontentloaded'});
        if(entry==='login'){await page.waitForFunction(()=>{const form=document.querySelector('form');return form&&Object.keys(form).some((key)=>key.startsWith('__reactProps$'));});await page.locator('input[type=email]').fill(user.email);await page.locator('input[type=password]').fill('synthetic-password');await page.getByRole('button',{name:'Se connecter',exact:true}).click();}
        await page.waitForSelector('main input',{timeout:120000});
        if(variant==='current' && entry==='students') await page.getByRole('status').filter({hasText:/résultat/}).waitFor({timeout:30000});
        const clickToUseMs=performance.now()-start;
        await sleep(500);
        const metrics=await cdp.send('Performance.getMetrics');
        const longTasks=await page.evaluate(()=>window.__longTasks);
        const initial=[...calls]; calls.length=0;
        const searchStart=performance.now();
        const search=page.locator('main input').first(); if(entry==='students') await search.fill('Nom400');
        await sleep(500);
        const searchMs=performance.now()-searchStart;
        results.push({variant,history,roster,sample,entry:entry==='login'?'fresh login to normal Dashboard':'authenticated direct /students',cache:'cold IndexedDB',browser:browser.version(),network:'local synthetic intercepted; no latency shaping',clickToUseMs,searchMs,staticAssetsEncodedBytes:staticBytes,mainThreadTaskSeconds:metrics.metrics.find((m)=>m.name==='TaskDuration')?.value,longTasks,initial:{calls:initial,requests:initial.length,tables:[...new Set(initial.map((c)=>c.table))],rows:initial.reduce((a,c)=>a+c.rows,0),bytes:initial.reduce((a,c)=>a+c.bytes,0)},searchRequests:calls,writes});
        if (process.env.ANNABA_EXTENDED === "1") {
          const warmStart=performance.now(); calls.length=0;
          await page.reload({waitUntil:'domcontentloaded'});
          await page.waitForSelector('main input',{timeout:120000});
          if(variant==='current' && entry==='students') await page.getByRole('status').filter({hasText:/résultat/}).waitFor();
          results.at(-1).warmClickToUseMs=performance.now()-warmStart;
          await sleep(600);results.at(-1).warmRequests=[...calls];calls.length=0;
          await page.clock.install();
          await page.evaluate(()=> { Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange')); });
          await page.clock.fastForward(4*60*1000);
          await page.evaluate(()=> { Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange')); });
          await page.clock.runFor(5000);
          await page.clock.resume();
          await page.waitForFunction(() => !document.querySelector('.revalidate-bar'), null, { timeout:60000 });
          await sleep(1500);
          results.at(-1).returnAfterFourMinutesRequests=[...calls];
        }
        console.log(JSON.stringify({variant,history,roster,sample,clickToUseMs,requests:initial.length,rows:results.at(-1).initial.rows,bytes:results.at(-1).initial.bytes,writes:writes.length}));
        await context.close();
      }
    }
  } finally { await browser.close(); fs.writeFileSync(output,JSON.stringify(results,null,2)); }
})().catch((error)=>{console.error(error.message);process.exitCode=1;});
