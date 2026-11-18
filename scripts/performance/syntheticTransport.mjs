// Synthetic-only transport. Every non-local request is intercepted, including
// authentication. No production credentials or server are contacted.
export const uid = '00000000-0000-4000-8000-000000000001';
export const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { role: 'reception', full_name: 'Synthetic Desk' },
  created_at: '2026-01-01T00:00:00.000Z' };
export const auth = {
  access_token: `e30.${Buffer.from(JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.synthetic`,
  refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now()/1000)+3600, user,
};
export const sessionKey = 'altech-school-auth-nxbdvyfmtksknbvfcfdk';

export function historyFixture(base, history) {
  const data = structuredClone(base);
  for (const table of ['attendance_records', 'payments', 'teacher_payments']) {
    const model = data[table]?.[0] || { id: 'model' };
    data[table] ||= [];
    for (let i=0; i<history; i++) data[table].push({ ...model, id: `history-${i}`, student_id: 'synthetic-00499',
      session_id: 'archived-unrelated', subscription_id: 'archived-unrelated', occurred_at: '2025-01-01T12:00:00.000Z', date: '2025-01-01' });
  }
  return data;
}

export async function installTransport(context, data, calls, writes) {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    if (!url.hostname.endsWith('.supabase.co')) return route.abort();
    if (url.pathname.startsWith('/auth/')) return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(url.pathname.endsWith('/user') ? user : auth) });
    const table = url.pathname.split('/').pop();
    if (!['GET','HEAD'].includes(request.method()) && table !== 'admin_exists') {
      writes.push({ table, method: request.method() });
      return route.fulfill({ status: 409, contentType: 'application/json', body: '{"message":"Synthetic benchmark rejects mutations"}' });
    }
    let rows = table === 'profiles' ? [{ id: uid, role: 'reception', entity_id: uid, full_name: 'Synthetic Desk', email: user.email }]
      : table === 'reception_staff' ? [{ id: uid, first_name: 'Synthetic', last_name: 'Desk',
        nav_keys: ['dashboard','students','attendance','cash'],
        action_keys: ['students:view','students:pay','students:scan','students:print_receipt','attendance:mark'] }]
      : structuredClone(data[table] || []);
    for (const [column, expr] of url.searchParams) {
      if (expr.startsWith('eq.')) rows = rows.filter((r) => String(r[column]) === expr.slice(3));
      if (expr.startsWith('gte.')) rows = rows.filter((r) => String(r[column]) >= expr.slice(4));
      if (expr.startsWith('gt.')) rows = rows.filter((r) => String(r[column]) > expr.slice(3));
      if (expr.startsWith('lt.')) rows = rows.filter((r) => String(r[column]) < expr.slice(3));
      if (expr.startsWith('in.(')) {
        const ids = expr.slice(4,-1).split(',').map((v) => v.replace(/^"|"$/g,''));
        rows = rows.filter((r) => ids.includes(String(r[column])));
      }
    }
    // The workflow uses legacy local search. The directory's one fixed test
    // query is supported too; this is not a general PostgREST grammar emulator.
    if (table === 'students' && url.searchParams.getAll('or').join('').includes('Nom400')) rows = rows.filter((r) => r.last_name === 'Nom400');
    const count = rows.length;
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 1000);
    if (url.searchParams.has('order')) {
      const fields = url.searchParams.get('order').split(',').map((v) => v.split('.'));
      rows.sort((a,b) => {
        for (const [field, direction] of fields) {
          const cmp = String(a[field] ?? '').localeCompare(String(b[field] ?? ''));
          if (cmp) return direction === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
    }
    rows = rows.slice(offset, offset+limit);
    const select = url.searchParams.get('select');
    if (select && select !== '*') rows = rows.map((row) => Object.fromEntries(select.split(',').map((key) => [key, row[key] ?? null])));
    const body = table === 'admin_exists' ? 'true' : JSON.stringify(request.headers().accept?.includes('vnd.pgrst.object') ? rows[0] || null : rows);
    calls.push({ table, method: request.method(), query: url.search, rows: rows.length, bytes: Buffer.byteLength(body) });
    await route.fulfill({ status: 200, contentType: 'application/json', body,
      headers: { 'content-range': `${offset}-${Math.max(offset,offset+rows.length-1)}/${count}`, 'access-control-expose-headers': 'content-range' } });
  });
}
