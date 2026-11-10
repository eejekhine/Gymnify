// Group session tests. Two browsers (Ana and Ben) talk to one in-memory stand-in for the database.
// The real rules (friends only, invite only, who can read which sets) live in supabase/group-sessions.sql;
// these tests check the app: invites, live progress, offline queue, high-fives, ending and leaving.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const li = html.lastIndexOf('})();');
const hubHtml = html.replace('<script>', '<script>window.GYM_HUB=true;');
html = html.slice(0, li) + 'window.EV=function(c){return eval(c)};\n' + html.slice(li);
const hubPage = hubHtml.slice(0, hubHtml.lastIndexOf('})();')) + 'window.EV=function(c){return eval(c)};\n' + hubHtml.slice(hubHtml.lastIndexOf('})();'));
const mime = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
let variant = 'app';
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  if (u === '/' || u === '/index.html') { r.setHeader('content-type', 'text/html'); return r.end(variant === 'hub' ? hubPage : html); }
  try { const f = path.join(root, u.slice(1)); r.setHeader('content-type', mime[path.extname(f)] || 'text/plain'); r.end(fs.readFileSync(f)); } catch (e) { r.statusCode = 404; r.end(); }
});
let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   got:  ' + JSON.stringify(got) + '\n   want: ' + JSON.stringify(want))); };

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const ANA = 'aaaaaaaa-0000-4000-8000-000000000001', BEN = 'bbbbbbbb-0000-4000-8000-000000000002';
const names = { [ANA]: 'Ana', [BEN]: 'Ben' };
const jwt = id => 'h.' + b64({ sub: id }) + '.s';
const uidOf = req => { const a = req.headers()['authorization'] || ''; try { return JSON.parse(Buffer.from(a.replace('Bearer ', '').split('.')[1], 'base64url').toString()).sub; } catch (e) { return null; } };

// ---- the stand-in database
const db = { prefs: {}, sessions: [], members: [], sets: [], hi5: [], n: 0, missing: false, calls: [], down: {}, state: {} };
const memberOf = (sid, u) => db.members.find(m => m.session_id === sid && m.user_id === u);
function handle(route) {
  const req = route.request(), url = new URL(req.url()), p = url.pathname.replace('/rest/v1/', ''), me = uidOf(req), method = req.method();
  const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body === undefined ? null : body), headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  const err = (status, message) => ok({ message }, status);
  if (db.down[me]) return route.abort('internetdisconnected');
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (url.pathname.includes('/auth/v1/token')) return ok({ access_token: jwt(BEN), refresh_token: 'r2', expires_in: 3600, user: { email: 'ben@example.test' } });
  if (p === 'gymnify_state') {
    if (method === 'GET') return ok(db.state[me] ? [db.state[me]] : []);
    let b0 = {}; try { b0 = JSON.parse(req.postData() || '{}'); } catch (e) {}
    db.state[me] = { data: b0.data, updated: b0.updated }; return ok(null, 201);
  }
  if (db.missing) return err(404, 'Could not find the function');
  let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
  db.calls.push(method + ' ' + p);
  const sessView = s => ({ id: s.id, title: s.title, host_id: s.host_id, status: s.status, plan: s.plan, created_at: s.created_at, my_status: memberOf(s.id, me).status,
    members: db.members.filter(m => m.session_id === s.id && m.status !== 'declined').map(m => ({ id: m.user_id, name: names[m.user_id], colour: null, status: m.status })) });
  if (p === 'gym_prefs') { if (method === 'GET') return ok(db.prefs[me] === undefined ? [] : [{ group_ok: db.prefs[me] }]); db.prefs[body.user_id] = body.group_ok; return ok(null, 201); }
  if (p === 'rpc/gym_friends') return ok(Object.keys(names).filter(u => u !== me && db.prefs[u]).map(u => ({ id: u, display_name: names[u], username: names[u].toLowerCase(), colour: null })));
  if (p === 'rpc/gym_my_sessions') return ok(db.sessions.filter(s => { const m = memberOf(s.id, me); return m && m.status !== 'declined'; }).map(sessView));
  if (p === 'rpc/gym_create_session') {
    const s = { id: 'sess-' + (++db.n), host_id: me, title: body.p_title, plan: body.p_plan, status: 'open', created_at: new Date().toISOString() };
    db.sessions.push(s); db.members.push({ session_id: s.id, user_id: me, status: 'joined' });
    (body.p_invite || []).forEach(u => { if (db.prefs[u]) db.members.push({ session_id: s.id, user_id: u, status: 'invited' }); });
    return ok(s.id);
  }
  if (p === 'rpc/gym_invite') { let n = 0; (body.ids || []).forEach(u => { if (db.prefs[u] && !memberOf(body.sid, u)) { db.members.push({ session_id: body.sid, user_id: u, status: 'invited' }); n++; } }); return ok(n); }
  if (p === 'rpc/gym_respond') { const m = memberOf(body.sid, me); if (!m || m.status !== 'invited') return err(400, 'no open invite'); m.status = body.accept ? 'joined' : 'declined'; return ok(null, 204); }
  if (p === 'rpc/gym_leave') { const m = memberOf(body.sid, me); if (m) m.status = 'left'; if (!db.members.some(x => x.session_id === body.sid && x.status === 'joined')) db.sessions.find(s => s.id === body.sid).status = 'ended'; return ok(null, 204); }
  if (p === 'rpc/gym_end') { const s = db.sessions.find(x => x.id === body.sid); if (!s || s.host_id !== me) return err(400, 'only the host can end an open session'); s.status = 'ended'; return ok(null, 204); }
  if (p === 'gym_session_sets') {
    const sid = (url.searchParams.get('session_id') || '').replace('eq.', '');
    if (method === 'GET') { const m = memberOf(sid, me); if (!m || !['joined', 'left'].includes(m.status)) return ok([]); return ok(db.sets.filter(x => x.session_id === sid)); }
    if (method === 'POST') { const m = memberOf(body.session_id, me), s = db.sessions.find(x => x.id === body.session_id); if (!m || m.status !== 'joined' || !s || s.status !== 'open') return err(403, 'new row violates row-level security policy'); const i = db.sets.findIndex(x => x.session_id === body.session_id && x.user_id === me && x.client_key === body.client_key); const row = { ...body, user_id: me, created_at: new Date().toISOString() }; if (i >= 0) db.sets[i] = row; else db.sets.push(row); return ok(null, 201); }
    if (method === 'DELETE') { const key = (url.searchParams.get('client_key') || '').replace('eq.', ''); db.sets = db.sets.filter(x => !(x.session_id === sid && x.user_id === me && x.client_key === key)); return ok(null, 204); }
  }
  if (p === 'gym_session_hi5') {
    const sid = (url.searchParams.get('session_id') || '').replace('eq.', '');
    if (method === 'GET') return ok(db.hi5.filter(x => x.session_id === sid));
    if (method === 'POST') { db.hi5.push({ session_id: body.session_id, from_user: me, to_user: body.to_user }); return ok(null, 201); }
  }
  return err(404, 'unhandled ' + method + ' ' + p);
}

(async () => {
  await new Promise(r => srv.listen(0, r));
  const url = 'http://localhost:' + srv.address().port + '/';
  const b = await chromium.launch();
  const errs = [];
  async function user(id, extra = {}) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/London' });
    await ctx.route('**/*supabase.co/**', handle);
    await ctx.addInitScript(([a, ex]) => {
      try {
        if (!localStorage.getItem('gymnify.auth')) localStorage.setItem('gymnify.auth', JSON.stringify({ access_token: a, refresh_token: 'r', expires_at: 9999999999, email: 'x@example.com' }));
        if (!localStorage.getItem('gym.v1')) localStorage.setItem('gym.v1', JSON.stringify({ v: 1, updated: 1, mode: 'gym', seeded: true, settings: { setupDone: true, unit: 'kg', rest: 0, sound: false, vibrate: false, keepAwake: false, kitGym: {}, kitHome: {} }, routines: [{ id: 'push', name: 'Push day', tag: 'x', items: [{ ex: 'bench', sets: 3, reps: '5', rest: 0, note: '' }, { ex: 'ohp', sets: 2, reps: '8', rest: 0, note: '' }] }], sessions: [], weights: [], measures: [], customEx: [], lastDone: {}, plan: {}, tomb: {} }));
      } catch (e) {}
    }, [jwt(id), extra]);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(id.slice(0, 2) + ': ' + e.message));
    await p.goto(url); await p.waitForTimeout(400);
    return { ctx, p, E: c => p.evaluate(x => EV(x), c), text: async s => (await p.locator(s || '#app').innerText()).replace(/\n+/g, ' | ') };
  }
  const ana = await user(ANA), ben = await user(BEN);
  const load = u => u.E('new Promise(function(r){gsLoad(function(){r(1)})})');

  // --- opt in
  await ben.E("nav={tab:'today',sub:{k:'settings'}};render()");
  await ben.p.waitForTimeout(300);
  eq('settings shows the Train together card when signed in', (await ben.text('#gsset')).includes('Let my Klander friends invite me'), true);
  await ben.p.click('[data-act=gsopt]'); await ben.p.waitForTimeout(300);
  eq('turning on friend invites is saved', db.prefs[BEN], true);

  // --- Ana starts a session
  await ana.E("nav={tab:'today',sub:null};render()"); await load(ana);
  eq('today shows a start card', (await ana.text('#gscard')).includes('Start a group session'), true);
  await ana.p.click('#gscard [data-act=gsstart]'); await ana.p.waitForSelector('#gs-r');
  eq('friends who opted in are listed', (await ana.text('#gsfl')).includes('Ben'), true);
  await ana.p.selectOption('#gs-r', 'push'); await ana.p.fill('#gs-t', 'Friday push');
  await ana.p.click('#gsfl .chip'); await ana.p.click('[data-act=gscreate]'); await ana.p.waitForSelector('#gsbar .gm');
  eq('host is in a live workout with the group strip', [await ana.E('S.active.name'), await ana.E('S.active.entries.length'), await ana.E('!!S.active.gs')], ['Friday push', 2, true]);
  eq('Ben shows as invited', (await ana.text('#gsbar')).includes('INVITED'), true);

  // --- Ben joins from his invite
  await ben.E("nav={tab:'today',sub:null};render()"); await load(ben);
  eq('Ben sees the invite', (await ben.text('#gscard')).includes('Ana invited you to Friday push'), true);
  await ben.p.click('[data-act=gsjoin]'); await ben.p.waitForSelector('#gsbar .gm');
  eq('joining builds the same routine for Ben', [await ben.E('S.active.entries.map(function(e){return e.ex}).join()'), await ben.E('S.active.gs.id')], ['bench,ohp', 'sess-1']);

  // --- live progress
  await ana.E("S.active.entries[0].sets[0].w='60';S.active.entries[0].sets[0].r='5'");
  await ana.p.click('[data-act=tick][data-i="0"][data-s="0"]'); await ana.p.waitForTimeout(400);
  eq('a ticked working set reaches the group', db.sets.map(x => [x.user_id === ANA ? 'ana' : 'ben', x.exercise, x.weight_kg, x.reps]), [['ana', 'Bench Press', 60, 5]]);
  await load(ben);
  const bt = await ben.text('#gsbar');
  eq("Ben sees Ana's set live", [bt.includes('Ana'), bt.includes('Bench Press 60 kg'), bt.includes('1/5')], [true, true, true]);

  // --- warm-up sets stay private
  await ana.E("S.active.entries[0].sets[1].t='w';S.active.entries[0].sets[1].w='20';S.active.entries[0].sets[1].r='10'");
  await ana.p.click('[data-act=tick][data-i="0"][data-s="1"]'); await ana.p.waitForTimeout(300);
  eq('warm-up sets are not sent', db.sets.length, 1);

  // --- high five
  await ben.p.click('[data-act=gshi5]'); await ben.p.waitForTimeout(300);
  await load(ana);
  eq('high-five arrives', (await ana.text('#gsbar')).includes('✋ 1'), true);

  // --- editing a ticked set updates the group
  await ana.E("S.active.entries[0].sets[0].w='62.5'"); await ana.E("gsTouch(0,0)"); await ana.p.waitForTimeout(1300);
  eq('changing a ticked set re-sends it (no duplicate)', db.sets.map(x => x.weight_kg), [62.5]);

  // --- offline queue
  await ben.E("S.active.entries[0].sets[0].w='50';S.active.entries[0].sets[0].r='8'");
  db.down[BEN] = true;
  await ben.p.click('[data-act=tick][data-i="0"][data-s="0"]'); await ben.p.waitForTimeout(400);
  eq('offline: the set is queued, not lost', [await ben.E('S.active.gs.q.length'), db.sets.length], [1, 1]);
  eq('the strip says a set is waiting', (await ben.text('#gsbar')).includes('1 set waiting'), true);
  db.down[BEN] = false;
  await ben.E('new Promise(function(r){gsFlush(S.active.gs,function(){r(1)})})');
  eq('back online: the queue empties and the set arrives once', [await ben.E('S.active.gs.q.length'), db.sets.filter(x => x.user_id === BEN).length], [0, 1]);

  // --- un-ticking removes it
  await ben.p.click('[data-act=tick][data-i="0"][data-s="0"]'); await ben.p.waitForTimeout(400);
  eq('un-ticking a set removes it for everyone', db.sets.filter(x => x.user_id === BEN).length, 0);

  // --- invite more
  await ana.p.click('[data-act=gsmenu]'); await ana.p.click('[data-act=gsinvite]'); await ana.p.waitForTimeout(400);
  eq('nobody left to invite is explained', (await ana.text('#gsinv')).includes('No more friends'), true);
  await ana.p.click('[data-act=closesheet]');

  // --- Ben leaves the group but keeps his workout
  await ben.p.click('[data-act=gsmenu]'); await ben.p.click('li[data-act=gsleave]'); await ben.p.waitForTimeout(500);
  eq('leaving keeps the workout, drops the group', [await ben.E('!!S.active'), await ben.E('!!S.active.gs'), memberOf(db.sessions[0].id, BEN).status], [true, false, 'left']);

  // --- host ends it
  await ana.p.click('[data-act=gsmenu]'); await ana.p.click('li[data-act=gsend]'); await ana.p.waitForTimeout(500);
  await load(ana);
  eq('host can end the session for everyone', [db.sessions[0].status, (await ana.text('#gsbar')).includes('ended')], ['ended', true]);
  // finishing after the end still saves the workout; the rejected send is dropped
  await ana.E("S.active.entries[1].sets[0].w='30';S.active.entries[1].sets[0].r='8'");
  await ana.p.click('[data-act=tick][data-i="1"][data-s="0"]'); await ana.p.waitForTimeout(400);
  eq('after the end, a rejected set is dropped from the queue', await ana.E('S.active.gs.q.length'), 0);
  await ana.p.click('[data-act=finish]'); await ana.p.waitForTimeout(600);
  eq('finishing still saves the workout locally', await ana.E('S.sessions.length'), 1);
  await ana.p.click('[data-act=closesheet]');

  // --- results sheet
  await load(ana);
  await ana.p.click('[data-act=gssum]'); await ana.p.waitForTimeout(500);
  const sum = await ana.text('.sheet');
  eq('results show the group', [sum.includes('Friday push'), sum.includes('Ana'), sum.includes('Ben')], [true, true, true]);
  await ana.p.click('[data-act=closesheet]');

  // --- decline
  await ana.E("nav={tab:'today',sub:null};render()");
  db.sessions.push({ id: 'sess-9', host_id: BEN, title: 'Leg day', plan: [], status: 'open', created_at: new Date().toISOString() });
  db.members.push({ session_id: 'sess-9', user_id: BEN, status: 'joined' }, { session_id: 'sess-9', user_id: ANA, status: 'invited' });
  await load(ana); await ana.p.click('[data-act=gsdecline]'); await ana.p.waitForTimeout(500);
  eq('declining an invite', memberOf('sess-9', ANA).status, 'declined');

  // --- not switched on yet (database change not applied): clear message, no crash
  db.missing = true;
  const cara = await user(ANA); await cara.E("nav={tab:'today',sub:null};render()"); await load(cara); await cara.p.waitForTimeout(200);
  eq('missing tables give a clear message', (await cara.text('#gscard')).includes('not switched on'), true);
  eq('workouts still work with groups unavailable', await cara.E("startEmpty();!!S.active&&!S.active.gs"), true);
  db.missing = false;

  // --- signed out and hub build
  const out = await b.newContext({ viewport: { width: 390, height: 844 } }); const op = await out.newPage(); op.on('pageerror', e => errs.push('out: ' + e.message));
  await op.addInitScript(() => localStorage.setItem('gym.v1', JSON.stringify({ v: 1, updated: 1, mode: 'gym', seeded: true, settings: { setupDone: true, unit: 'kg', rest: 0, kitGym: {}, kitHome: {} }, routines: [], sessions: [], weights: [], measures: [], customEx: [], lastDone: {}, plan: {}, tomb: {} })));
  await op.goto(url); await op.waitForTimeout(400);
  eq('signed out: a card points to Settings', (await op.locator('#gscard').innerText()).includes('Sign in under Settings'), true);
  variant = 'hub';
  await out.route('**/*supabase.co/**', handle);
  const hp = await out.newPage(); hp.on('pageerror', e => errs.push('hub: ' + e.message)); await hp.goto(url); await hp.waitForTimeout(400);
  await hp.evaluate(() => { nav = { tab: 'today', sub: { k: 'settings' } }; });
  await hp.evaluate(() => EV("nav={tab:'today',sub:{k:'settings'}};render()"));
  eq('hub copy offers a separate Klander sign-in for groups', [await hp.locator('#gs-email').count(), (await hp.locator('#gsset').innerText()).includes('separate from your Hub sign-in')], [1, true]);
  // Gymnify account already holds a workout and a routine; the hub copy holds a different workout
  db.state[BEN] = { updated: 50, data: { v: 1, updated: 50, sessions: [{ id: 'gym-s1', date: '2026-11-02', name: 'Gymnify pull', mode: 'gym', start: 1, end: 2, entries: [] }], routines: [{ id: 'r-g', name: 'Gymnify routine', tag: 'x', items: [] }], weights: [], measures: [], customEx: [], lastDone: {}, plan: {}, tomb: {}, settings: {} } };
  await hp.evaluate(() => EV("S.sessions.push({id:'hub-s1',date:'2026-11-01',name:'Hub push',mode:'gym',start:1,end:2,entries:[]});save()"));
  await hp.fill('#gs-email', 'ben@example.test'); await hp.fill('#gs-pass', 'not-a-real-pass'); await hp.click('[data-act=gssignin]'); await hp.waitForTimeout(700);
  eq('after signing in the hub copy can use groups', [await hp.locator('[data-act=gsopt]').count(), (await hp.locator('#gsset').innerText()).includes('Signed in to Klander as')], [1, true]);
  await hp.waitForTimeout(600);
  eq('signing in merges Hub and Gymnify workouts both ways', [(await hp.evaluate(() => EV("S.sessions.map(function(x){return x.id}).sort().join()"))), db.state[BEN].data.sessions.map(x => x.id).sort().join(), (await hp.evaluate(() => EV("S.routines.some(function(r){return r.id==='r-g'})")))], ['gym-s1,hub-s1', 'gym-s1,hub-s1', true]);
  eq('the settings card shows the sync status', (await hp.locator('#gsset').innerText()).includes('Synced with Gymnify'), true);
  await hp.evaluate(() => EV("S.sessions.push({id:'hub-s2',date:'2026-11-03',name:'Hub legs',mode:'gym',start:1,end:2,entries:[]});save()")); await hp.waitForTimeout(3300);
  eq('a new Hub workout reaches the Gymnify account', db.state[BEN].data.sessions.map(x => x.id).includes('hub-s2'), true);
  eq('hub sign-in stays separate from the hub login key', await hp.evaluate(() => Object.keys(localStorage).filter(k => /^sb-/.test(k)).length), 0);
  await hp.click('[data-act=gssignout]'); await hp.waitForTimeout(300);
  eq('hub copy can sign out of groups', await hp.locator('#gs-email').count(), 1);

  eq('no page errors', errs, []);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
