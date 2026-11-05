// Gymnify tests. Run: npm install && npx playwright install chromium && npm test
// Loads index.html in a headless browser with a small hook that exposes the app's internals, then checks behaviour.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const i = html.lastIndexOf('})();');
html = html.slice(0, i) + 'window.EV=function(c){return eval(c)};\n' + html.slice(i);
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  if (u === '/' || u === '/index.html') { r.setHeader('content-type', 'text/html'); return r.end(html); }
  try { const f = path.join(root, u.slice(1)); r.setHeader('content-type', mime[path.extname(f)] || 'text/plain'); r.end(fs.readFileSync(f)); } catch (e) { r.statusCode = 404; r.end(); }
});
let pass = 0, fail = 0;
const EXLISTJ = ['max_jump','jump_squat','depth_sl','sl_hop','broad','ankle_hop','pogo','approach','tuck_jump','box_jump','lat_bound','skater'];
const NOW = Date.now();
const mime = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   got:  ' + JSON.stringify(got) + '\n   want: ' + JSON.stringify(want))); };
(async () => {
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, timezoneId: 'Europe/London' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const E = c => p.evaluate(x => EV(x), c);
  const text = async s => (await p.locator(s || '#app').innerText()).replace(/\n+/g, ' | ');
  await p.goto('http://localhost:' + port + '/'); await p.waitForTimeout(500);

  // --- first run
  eq('new user sees setup, no nav', [await E('S.settings.setupDone'), (await p.locator('#nav').innerHTML()).length === 0], [false, true]);
  eq('new user starts with no routines', await E('S.routines.length'), 0);

  // --- merge
  await E('S.settings.setupDone=true');
  const M = (a, b) => E('mergeState(' + JSON.stringify(a) + ',' + JSON.stringify(b) + ')');
  const base = { v: 1, updated: 100, sessions: [{ id: 'a' }], routines: [{ id: 'r1', name: 'Old' }], weights: [{ d: '2026-11-01', kg: 80 }], measures: [], customEx: [], lastDone: {}, plan: {}, tomb: {}, settings: {} };
  let m = await M({ ...base, sessions: [{ id: 'a' }, { id: 'b' }], updated: 200 }, { ...base, sessions: [{ id: 'a' }, { id: 'c' }], updated: 150 });
  eq('sessions from two devices are combined', m.sessions.map(x => x.id).sort(), ['a', 'b', 'c']);
  m = await M({ ...base, routines: [], tomb: { 'r:r1': NOW }, updated: 300 }, { ...base, updated: 150 });
  eq('a routine deleted on one device stays deleted', m.routines.length, 0);
  m = await M({ ...base, routines: [{ id: 'r1', name: 'Mine' }], updated: 100 }, { ...base, routines: [{ id: 'r1', name: 'Newer' }], updated: 400 });
  eq('newer copy wins when the same routine differs', m.routines[0].name, 'Newer');
  m = await M({ v: 1, updated: 900, sessions: [], routines: [], weights: [], measures: [], customEx: [], lastDone: {}, plan: {}, tomb: {}, settings: { theme: 'ember' } }, { ...base, settings: { theme: 'midnight' }, updated: 50 });
  eq('a fresh device takes the account copy', [m.settings.theme, m.sessions.length], ['midnight', 1]);
  m = await M({ ...base, weights: [{ d: '2026-11-01', kg: 79 }, { d: '2026-11-02', kg: 80 }], updated: 500 }, { ...base, weights: [{ d: '2026-11-01', kg: 80 }], tomb: { 'w:2026-11-02': NOW }, updated: 450 });
  eq('deleted body weight is not resurrected', m.weights.map(x => x.d), ['2026-11-01']);
  m = await M({ ...base, sessions: [{ id: 'a' }], updated: 5 }, { ...base, sessions: [], tomb: { 's:a': NOW }, updated: 10 });
  eq('reset on one device clears sessions on the other', m.sessions.length, 0);

  // --- units
  await E(`S.sessions.push({id:'s1',date:'2026-11-01',name:'Test, "Push"',mode:'gym',start:1,end:3600001,entries:[{ex:'bench',reps:'5',sets:[{w:'60',r:'8',d:true,t:'w'},{w:'100',r:'5',d:true},{w:'100',r:'5',d:true,pr:true}]}]});save();render()`);
  eq('kg display', await E("dW(100)"), '100');
  await E("S.settings.unit='lb'");
  eq('lb display', await E("dW(100)"), '220.5');
  eq('lb entry converts to kg', await E("kgStr('225')"), '102.058');
  await E("S.settings.unit='kg'");
  eq('kg entry is unchanged', await E("kgStr('62.5')"), '62.5');

  // --- csv
  await E("nav={tab:'today',sub:{k:'settings'}};render()");
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=csvexport]')]);
  const tmp = path.join(require('os').tmpdir(), 'gymnify-test.csv'); await dl.saveAs(tmp);
  const lines = fs.readFileSync(tmp, 'utf8').trim().split('\n');
  eq('csv has header plus 3 sets', lines.length, 4);
  eq('csv quotes names with commas and quotes', lines[1].startsWith('2026-11-01,"Test, ""Push""",gym,Bench Press,1,warm-up,60'), true);

  // --- supersets
  await E("S.active=null;S.routines=[{id:'rs',name:'SS test',items:[{ex:'bench',sets:3,reps:'8',rest:90,note:''},{ex:'cable_row',sets:3,reps:'10',rest:60,note:''},{ex:'squat',sets:3,reps:'5',rest:120,note:''}]}];save()");
  eq('linking exercise 1 with the next creates a superset', await E("var it=S.routines[0].items;ssLink(it,0);ssRuns(it).map(function(r){return r.idx.join('+')+r.label}).join()"), '0+1A');
  eq('toggling again removes it', await E("var it=S.routines[0].items;ssLink(it,0);ssRuns(it).length"), 0);
  eq('last exercise cannot be linked to nothing', await E("ssLink(S.routines[0].items,2)"), null);
  await E("ssLink(S.routines[0].items,0);startRoutine('rs','gym');nav={tab:'today',sub:{k:'workout'}};save()");
  eq('superset carries into the workout', await E("S.active.entries.map(function(e){return !!e.ss}).join()"), 'true,true,false');
  await E("S.active.entries[0].sets[0].w='60';S.active.entries[0].sets[0].r='8'");
  await E("var ev=document.createElement('button');ev.dataset.act='tick';ev.dataset.i='0';ev.dataset.s='0';document.body.appendChild(ev);ev.click()");
  await p.waitForTimeout(200);
  eq('no rest timer between the two superset exercises', await E("S.active.rest"), null);
  await E("S.active.entries[1].sets[0].w='40';S.active.entries[1].sets[0].r='10'");
  await E("var ev2=document.createElement('button');ev2.dataset.act='tick';ev2.dataset.i='1';ev2.dataset.s='0';document.body.appendChild(ev2);ev2.click()");
  await p.waitForTimeout(200);
  eq('rest starts after the last exercise of the round', (await E("S.active.rest&&S.active.rest.total")), 60);
  await E("S.active=null;save()");

  // --- deload weeks
  const week = n => E("(function(){var d=monday(new Date());d.setDate(d.getDate()-7*" + n + ");return ymd(d)})()");
  let sess = [];
  for (let n = 1; n <= 5; n++) { const d = await week(n); sess.push({ id: 'dw' + n + 'a', date: d, name: 'x', mode: 'gym', start: 1, end: 2, entries: [{ ex: 'bench', reps: '5', sets: [{ w: '100', r: '5', d: true }, { w: '100', r: '5', d: true }, { w: '100', r: '5', d: true }] }] }); sess.push({ id: 'dw' + n + 'b', date: d, name: 'x', mode: 'gym', start: 3, end: 4, entries: [] }); }
  await E("S.sessions=" + JSON.stringify(sess) + ";S.deload=null;S.deloadSnooze=0;S.settings.deloadEvery=5;S.settings.weekGoal=3;save()");
  eq('five training weeks in a row makes a deload due', [await E("trainedWeeksInARow()"), await E("deloadDue()")], [5, true]);
  await E("S.settings.deloadEvery=0");
  eq('deload can be turned off', await E("deloadDue()"), false);
  await E("S.settings.deloadEvery=5;S.deloadSnooze=Date.now()+1e6");
  eq('not now hides the suggestion', await E("deloadDue()"), false);
  await E("S.deloadSnooze=0;S.deload={start:mondayKey()}");
  eq('deload week is active and not suggested again', [await E("deloadActive()"), await E("deloadDue()")], [true, false]);
  eq('deload cuts 5 sets to 3 and keeps 1', [await E("deloadSets(5)"), await E("deloadSets(1)"), await E("deloadSets(2)")], [3, 1, 2]);
  eq('deload lowers 100 kg to 90 kg, 225 lb to 205 lb', [await E("deloadWeight(100)"), await E("S.settings.unit='lb';var r=Math.round(toU(deloadWeight(102.058)));S.settings.unit='kg';r")], [90, 205]);
  await E("S.routines=[{id:'rd',name:'D',items:[{ex:'bench',sets:5,reps:'5',rest:90,note:''}]}];startRoutine('rd','gym')");
  eq('workout started in a deload week has fewer sets', await E("S.active.entries[0].sets.length"), 3);
  eq('deload hint suggests the lighter weight', (await E("hintFor(S.active.entries[0])")).text.startsWith('Deload: 90 kg'), true);
  await E("S.active=null;S.deload={start:mondayKey(),ended:true}");
  eq('ending a deload early turns it off and restarts the count', [await E("deloadActive()"), await E("trainedWeeksInARow()")], [false, 0]);

  // --- wizard
  await b.close();
  const b2 = await chromium.launch(); const p2 = await (await b2.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p2.on('pageerror', e => errs.push(e.message));
  await p2.goto('http://localhost:' + port + '/'); await p2.waitForTimeout(400);
  for (const [sel] of [['[data-act="sunext"]']]) await p2.click(sel);
  await p2.click('[data-act="su"][data-v="strength"]'); await p2.click('[data-act="sunext"]');
  await p2.click('[data-act="su"][data-v="intermediate"]'); await p2.click('[data-act="sunext"]');
  await p2.click('[data-act="su"][data-k="days"][data-v="4"]'); await p2.click('[data-act="sunext"]');
  await p2.click('[data-act="su"][data-v="home"]'); await p2.click('[data-act="sunext"]');
  await p2.click('[data-act="sunext"]'); await p2.click('[data-act="sunext"]');
  await p2.click('[data-act="sufinish"][data-build="1"]'); await p2.waitForTimeout(300);
  const st = await p2.evaluate(() => JSON.parse(localStorage.getItem('gym.v1')));
  eq('wizard builds 4 routines for a 4-day home plan', st.routines.length, 4);
  eq('home plan has no barbell lifts', st.routines.some(r => r.items.some(i => ['bench', 'squat', 'deadlift', 'bb_row', 'ohp'].includes(i.ex))), false);
  eq('setup marked done', st.settings.setupDone, true);

  // --- welcome screen import shortcut
  const p3 = await (await b2.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p3.goto('http://localhost:' + port + '/'); await p3.waitForTimeout(400);
  await p3.click('[data-act="suimport"]'); await p3.waitForTimeout(300);
  eq('welcome import shortcut skips setup and opens import', [await p3.evaluate(() => EV("S.settings.setupDone")), (await p3.locator('#app').innerText()).includes('Paste anything here')], [true, true]);

  // --- athlete goal
  const pp = await b2.newPage ? null : null;
  const pl = await p2.evaluate(() => EV("genPlan({goal:'athlete',sport:'basketball',exp:'intermediate',days:4,mins:60,where:'gym',shuffle:0}).map(function(d){return [d.name,d.items.map(function(i){return i.ex})]})"));
  const lowerHasJump = pl.filter(d => /Lower/.test(d[0])).every(d => d[1].some(id => EXLISTJ.includes(id)));
  eq('athlete plan puts jump work on lower days', lowerHasJump, true);
  eq('athlete plan keeps jumps off upper days', pl.filter(d => /Upper/.test(d[0])).some(d => d[1].some(id => EXLISTJ.includes(id))), false);

  {
  const p = p2; const E = c => p.evaluate(x => EV(x), c); const text = async s => (await p.locator(s || '#app').innerText()).replace(/\n+/g, ' | ');
  // --- exercise library
  eq('library has well over 200 exercises', (await E('EXLIST.length')) > 220, true);
  eq('every exercise id is unique', await E('new Set(EXLIST.map(function(x){return x.id})).size===EXLIST.length'), true);
  eq('every swap option points at a real exercise', await E('EXLIST.filter(function(e){return e.alts.some(function(a){return !EX[a]})}).map(function(e){return e.id})'), []);
  eq('every equipment and muscle name is known', await E("EXLIST.filter(function(e){return e.muscle!=='Other'&&MUSCLES.indexOf(e.muscle)<0||e.eq.some(function(q){return !EQUIP.some(function(z){return z[0]===q})})}).map(function(e){return e.id})"), []);
  eq('every exercise has a way to do it at home or is gym-only by equipment', await E("EXLIST.every(function(e){return e.type==='w'||e.type==='b'||e.type==='t'})"), true);

  // --- calorie estimate
  await E("S.weights=[{d:'2026-11-01',kg:80}];S.settings.cal=true");
  const sets20 = "Array.apply(null,Array(20)).map(function(){return {w:'60',r:'10',d:true,t:'n'}})";
  eq('lifting estimate: 20 sets in an hour at 80 kg', await E("calEst({start:0,end:3600000,entries:[{ex:'bench',sets:" + sets20 + "}]})"), { kcal: 432, assumed: false });
  eq('cardio estimate uses the treadmill MET for the time on it', (await E("calEst({start:0,end:1800000,entries:[{ex:'treadmill',sets:[{w:'',r:'1800',d:true,t:'n'}]}]})")).kcal, 332);
  eq('no body weight assumes 75 kg and says so', await E("S.weights=[];calEst({start:0,end:3600000,entries:[{ex:'bench',sets:" + sets20 + "}]})"), { kcal: 405, assumed: true });
  eq('a workout with no time has no estimate', await E("calEst({start:5,end:5,entries:[]})"), null);
  eq('calorie estimate can be switched off', await E("S.settings.cal=false;calBlock({start:0,end:3600000,entries:[{ex:'bench',sets:" + sets20 + "}]})"), '');
  await E("S.settings.cal=true");
  eq('custom effort level overrides the estimate', await E("var id=addCustomEx('Testy hold','Core','t',[],9);S.active=null;calEst({start:0,end:600000,entries:[{ex:id,sets:[{w:'',r:'600',d:true,t:'n'}]}]}).kcal"), Math.round(9 * 75 * 600 / 3600));
  await E("S.customEx=S.customEx.filter(function(c){return c.name!=='Testy hold'});EXLIST=EXLIST.filter(function(e){return e.name!=='Testy hold'})");

  // --- rest reminders
  await E("window.__n=[];canNotify=function(){return true};showNote=function(t,o){window.__n.push([t,o.body])};S.settings.notify=true");
  eq('rest-over notification says what is next', [await E("notifyRestOver({next:'Bench Press set 2'},true)"), await E("window.__n")], [true, [['Rest over. Go!', 'Next: Bench Press set 2']]]);
  eq('notification is skipped while the app is on screen', await E("notifyRestOver({next:'x'})"), false);
  eq('notification is skipped when switched off', await E("S.settings.notify=false;notifyRestOver({next:'x'},true)"), false);
  await E("S.settings.notify=true;startEmpty();S.active.entries.push(mkEntry({ex:'bench',sets:3,reps:'8',rest:90},'gym'));S.active.entries.push(mkEntry({ex:'squat',sets:2,reps:'5',rest:120},'gym'));nav={tab:'today',sub:{k:'workout'}};save();render()");
  const tick = async (i, s) => { await E("var b=document.createElement('button');b.dataset.act='tick';b.dataset.i='" + i + "';b.dataset.s='" + s + "';var x=S.active.entries[" + i + "].sets[" + s + "];x.w=x.w||'60';x.r=x.r||'8';document.body.appendChild(b);b.click()"); await p.waitForTimeout(150); };
  await tick(0, 0);
  eq('rest after a set remembers the next set', await E("S.active.rest&&[S.active.rest.total,S.active.rest.next]"), [90, 'Bench Press set 2']);
  await tick(0, 1); await tick(0, 2);
  eq('rest after the last set points at the next exercise', await E("S.active.rest.next"), 'Back Squat');
  await E("S.active.rest.end=Date.now()-1000;S.active.rest.fired=false;window.__n=[];tick()");
  eq('rest timer fires once when it ends', await E("S.active.rest.fired"), true);
  eq('settings screen has the reminder switches', await E("S.settings.sound!==false&&S.settings.vibrate!==false&&S.settings.keepAwake!==false"), true);
  await E("S.active=null;save();nav={tab:'today',sub:{k:'settings'}};render()");
  const settingsText = await text();
  eq('settings shows Rest reminders and Calories cards', [/Rest reminders/.test(settingsText), /Calories and health apps/.test(settingsText), /Test it/.test(settingsText)], [true, true, true]);
  await E("nav={tab:'today',sub:null};render()");

  // --- custom exercises from the workout picker, and picking by muscle
  await E("startEmpty();nav={tab:'today',sub:{k:'workout'}};save();render()");
  await p.click('[data-act="addex"]'); await p.waitForTimeout(200);
  await p.click('[data-act="pickm"][data-m="Cardio"]'); await p.waitForTimeout(100);
  const cardioList = await p.locator('#picklist').innerText();
  eq('muscle chips filter the picker', [/Treadmill/.test(cardioList), /Bench Press/.test(cardioList)], [true, false]);
  await p.click('[data-act="pickm"][data-m=""]');
  await p.fill('#pickq', 'Landmine Squat Hold'); await p.waitForTimeout(100);
  eq('picker offers to create what you searched for', (await p.locator('[data-act="newexpick"]').innerText()).includes('Landmine Squat Hold'), true);
  await p.click('[data-act="newexpick"]'); await p.waitForTimeout(150);
  eq('the new-exercise form is prefilled with the search', await p.inputValue('#cx-name'), 'Landmine Squat Hold');
  await p.click('[data-act="cxeq"][data-q="barbell"]'); await p.selectOption('#cx-t', 't'); await p.selectOption('#cx-m', 'Core');
  await p.click('[data-act="savecx"]'); await p.waitForTimeout(200);
  eq('creating from the picker adds it to the workout', await E("S.active.entries.length+':'+exName(S.active.entries[0].ex)"), '1:Landmine Squat Hold');
  eq('custom exercise keeps its type, muscle and equipment', await E("var c=S.customEx[0];[c.type,c.muscle,c.eq.join(),c.name].join('|')"), 't|Core|barbell|Landmine Squat Hold');
  eq('custom exercise is searchable like any other', await E("EXLIST.some(function(e){return e.custom&&e.name==='Landmine Squat Hold'})"), true);
  await E("exDetail(S.customEx[0].id)"); await p.click('[data-act="editex"]'); await p.waitForTimeout(150);
  await p.fill('#cx-name', 'Landmine Hold'); await p.click('[data-act="savecx"]'); await p.waitForTimeout(150);
  eq('editing a custom exercise renames it everywhere', await E("[S.customEx[0].name,exName(S.customEx[0].id),exName(S.active.entries[0].ex),EXLIST.filter(function(e){return e.id===S.customEx[0].id})[0].name].join('|')"), 'Landmine Hold|Landmine Hold|Landmine Hold|Landmine Hold');
  await p.click('[data-act="addex"]'); await p.fill('#pickq', 'landmine hold'); await p.click('[data-act="newexpick"]'); await p.fill('#cx-name', 'landmine hold'); await p.click('[data-act="savecx"]'); await p.waitForTimeout(150);
  eq('creating a duplicate name from the picker reuses the existing one', await E("S.customEx.length+':'+S.active.entries.length"), '1:2');
  await E("S.active=null;save();nav={tab:'today',sub:null};render()");
  }
  eq('no page errors', errs, []);
  await b2.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
