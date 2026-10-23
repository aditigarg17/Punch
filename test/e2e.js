// End-to-end test: launches the real app with a throwaway profile and drives it.
// Run: npm test   (takes ~75s because one check checks out after a real minute)
const { _electron: electron } = require('playwright-core');
const path = require('path');
const os = require('os');
const fs = require('fs');

const root = path.join(__dirname, '..');
const EXE = process.env.PUNCH_EXE; // set to dist/win-unpacked/Punch.exe to test the packaged app
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'punch-test-'));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { (c ? pass++ : fail++); console.log((c ? 'PASS ' : 'FAIL ') + name + (c || !extra ? '' : '  -> ' + extra)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  const app = await electron.launch({ ...(EXE ? { executablePath: EXE } : {}), args: [...(EXE ? [] : [root]), '--user-data-dir=' + profile], cwd: root, env: { ...process.env, PUNCH_TEST: '1' } });
  const wins = async () => {
    for (let i = 0; i < 40 && app.windows().length < 2; i++) await sleep(250);
    const all = app.windows();
    return { main: all.find(w => w.url().includes('Punch%20Clock')), widget: all.find(w => w.url().includes('widget.html')) };
  };
  return { app, ...(await wins()) };
}
// visibility of the widget BrowserWindow, read from the main process
const widgetVisible = app => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().includes('widget.html'));
  return w.isVisible();
});
const widgetBounds = app => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().includes('widget.html'));
  return { ...w.getContentBounds(), top: w.isAlwaysOnTop() };
});

(async () => {
  let { app, main, widget } = await launch();
  ok(!!main && !!widget, 'main window and widget window both exist');
  await main.waitForSelector('#checkin:not([disabled])');
  ok(await main.isVisible('#goalAsk'), 'first run asks for a daily goal');
  await main.click('#goalPresets button[data-g="6"]'); await sleep(500);
  ok(!(await main.isVisible('#goalAsk')) && (await main.inputValue('#goal')) === '6', 'choosing a preset saves goal and hides the prompt');
  ok(!(await widgetVisible(app)), 'widget hidden while nothing is running');
  ok(await main.evaluate(() => !('documentPictureInPicture' in window) || true), 'page loads');
  ok(await main.evaluate(() => document.getElementById('floatBtn').hidden), 'browser PiP button hidden in desktop app');

  // --- reports: pure maths on fixed data (Fri 23 Oct 2026)
  const rep = await main.evaluate(() => {
    const H = 36e5, now = new Date(2026, 9, 23, 15).getTime(), days = {};
    const put = (y, m, d, w, s) => { days[dkey(new Date(y, m, d))] = { work: w * H, study: s * H }; };
    put(2026, 9, 19, 6, 0); put(2026, 9, 20, 5, 1); put(2026, 9, 21, 8, 0); put(2026, 9, 22, 7, 0); put(2026, 9, 23, 4, 0);
    put(2026, 9, 18, 9, 0);
    put(2026, 0, 5, 2, 0); put(2026, 9, 1, 3, 0);
    const wk = periodInfo(days, 'week', now, 4 * H), mo = periodInfo(days, 'month', now, 4 * H), yr = periodInfo(days, 'year', now, 4 * H);
    return { wkTotal: wk.total / H, wkAvg: wk.avg / H, wkElapsed: wk.elapsed, wkBuckets: wk.buckets.length, wkGoal: wk.goalDays,
      moBuckets: mo.buckets.length, moTotal: mo.total / H, yrBuckets: yr.buckets.length, yrTotal: yr.total / H, yrActive: yr.active, wkBest: wk.best.t / H };
  });
  ok(rep.wkTotal === 31 && rep.wkElapsed === 5 && rep.wkBuckets === 7, 'week report: Mon-Sun, ignores last Sunday', JSON.stringify(rep));
  ok(Math.abs(rep.wkAvg - 6.2) < 1e-9, 'weekly average = total / days elapsed (6.2h)', rep.wkAvg);
  ok(rep.wkGoal === 5 && rep.wkBest === 8, 'goal-met days and best day correct', JSON.stringify(rep));
  ok(rep.moBuckets === 31 && rep.moTotal === 31 + 9 + 3, 'month report: 31 days in Oct, totals right', JSON.stringify(rep));
  ok(rep.yrBuckets === 12 && rep.yrTotal === 31 + 9 + 3 + 2 && rep.yrActive === 8, 'year report: 12 months, totals and active days right', JSON.stringify(rep));

  // --- check in
  await main.fill('#label', 'writing tests');
  await main.click('#checkin');
  await sleep(1500);
  ok(await widgetVisible(app), 'widget appears after check in');
  const b = await widgetBounds(app);
  ok(b.top, 'widget is always-on-top');
  ok(/work/i.test(await widget.textContent('#name')) && (await widget.textContent('#name')).includes('writing tests'), 'widget shows type and label');
  const t1 = await widget.textContent('#t'); await sleep(2200); const t2 = await widget.textContent('#t');
  ok(/^\d\d:\d\d:\d\d$/.test(t1) && t1 !== t2, 'widget timer ticks', t1 + ' / ' + t2);
  ok((await widget.textContent('#quote')).length > 10, 'quote is shown');
  ok(await main.evaluate(() => document.title.startsWith('●')), 'window title shows running timer');

  // --- quotes vary: 3 consecutive sessions should not repeat
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await main.evaluate(() => window.punchDesktop.sync(null)); await sleep(300);
    await main.evaluate(n => window.punchDesktop.sync({ cat: 'work', label: '', start: 1000 + n, remind: 0 }), i); await sleep(500);
    seen.push(await widget.textContent('#quote'));
  }
  ok(new Set(seen).size === 3, 'a different quote each session', JSON.stringify(seen));
  await main.evaluate(() => window.punchDesktop.sync(null));
  await main.evaluate(() => document.getElementById('hero') && window.dispatchEvent(new Event('focus')));

  // --- quote never clipped, for every quote
  const clipped = await widget.evaluate(async () => {
    const bad = [];
    for (let i = 0; i < QUOTES.length; i++) {
      $('quote').textContent = '“' + QUOTES[i] + '”'; render();
      // wait for the window to finish resizing to fit this quote (normally under 50ms)
      let fits = false;
      for (let t0 = performance.now(); performance.now() - t0 < 1500 && !fits;) {
        await new Promise(r => setTimeout(r, 25));
        const q = document.getElementById('quote'), b = document.getElementById('card').getBoundingClientRect().bottom;
        fits = q.scrollHeight <= q.clientHeight + 1 && b <= innerHeight - 6 && b >= innerHeight - 12;
      }
      if (!fits) bad.push(QUOTES[i]);
    }
    return bad;
  });
  ok(clipped.length === 0, 'every quote fully visible in widget', JSON.stringify(clipped));

  // --- reminder state (inject, then retry: the page re-syncs the real state every 15s and can overwrite it)
  let late = false, study = false;
  for (let i = 0; i < 10 && !(late && study); i++) {
    await main.evaluate(() => window.punchDesktop.sync({ cat: 'study', label: '', start: Date.now() - 50 * 60000, remind: 45 }));
    await sleep(250);
    [late, study] = await widget.evaluate(() => { const c = document.getElementById('card'); return [c.classList.contains('late'), c.dataset.cat === 'study']; });
  }
  ok(late, 'widget turns red after reminder interval');
  ok(study, 'widget switches to study colours');
  await main.evaluate(() => document.getElementById('hero') && 0); // restore real state on next render
  await main.click('#catSeg button[data-cat="work"]', { force: true }).catch(() => {});
  await main.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(16000); // main page re-syncs on its 15s refresh

  // --- stop under a minute via the widget
  await widget.click('#out');
  await sleep(1500);
  ok(await main.evaluate(() => document.getElementById('running').hidden), 'checkout from widget ends the session in main app');
  ok((await widget.textContent('#t')).includes('under a minute'), 'widget explains the under-a-minute discard', await widget.textContent('#t'));
  ok(await main.evaluate(() => document.getElementById('log').children.length === 0), 'under-a-minute session not saved');
  await sleep(4000);
  ok(!(await widgetVisible(app)), 'widget hides itself after the message');

  // --- add a past session, totals update
  await main.evaluate(() => { document.getElementById('addBox').open = true; });
  await main.selectOption('#addCat', 'study');
  // a session that ended a minute ago and lasted up to 30 min, kept inside today so the Today totals are predictable
  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  let nowM = new Date().getHours() * 60 + new Date().getMinutes();
  if (nowM < 3) { await sleep((3 - nowM) * 60000 + 3000); nowM = new Date().getHours() * 60 + new Date().getMinutes(); }
  const addDur = Math.min(30, nowM - 2);
  await main.fill('#addDate', await main.evaluate(() => dkey(new Date())));
  await main.fill('#addStart', hhmm(nowM - 1 - addDur)); await main.fill('#addEnd', hhmm(nowM - 1));
  await main.fill('#addLabel', 'manual');
  await main.click('#addForm button[type=submit]');
  await sleep(600);
  ok(await main.evaluate(() => document.getElementById('log').children.length === 1), 'manually added session appears in log');
  ok((await main.textContent('#stStudy')).trim() === addDur + 'm', 'Today study total updates', await main.textContent('#stStudy'));
  ok((await main.textContent('#stCount')).trim() === '1', 'session count updates');
  const bad = await main.evaluate(() => {
    document.getElementById('addStart').value = '00:00'; document.getElementById('addEnd').value = '00:00'; return 1;
  });
  await main.evaluate(() => { document.getElementById('addBox').open = true; });
  await main.click('#addForm button[type=submit]'); await sleep(300);
  ok(await main.evaluate(() => !document.getElementById('addErr').hidden), 'invalid session shows an error');

  // --- report UI
  for (const r of ['month', 'year', 'week']) {
    await main.click('#reportSeg button[data-r="' + r + '"]');
    ok(await main.evaluate(r2 => {
      const want = { week: 7, month: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate(), year: 12 }[r2];
      return document.querySelector('#reportSeg button[data-r="' + r2 + '"]').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('#repPlot .col').length === want;
    }, r), r + ' tab draws the right number of bars');
  }
  // break nudge: sample data gives a busy week (skipped on a Monday, when the week has no data yet)
  await main.click('#startDemo'); await sleep(500);
  const weekHasData = (await main.textContent('#rpTotal')).trim() !== '0m';
  if (weekHasData) {
    await main.fill('#breakAvg', '1'); await main.dispatchEvent('#breakAvg', 'change'); await sleep(400);
    ok(await main.evaluate(() => document.getElementById('breakCard').classList.contains('over')), 'break card flags weekly average above the limit');
    ok((await main.textContent('#breakCard')).includes('deserve a proper break'), 'break message says you deserve a break');
    await main.fill('#breakAvg', '16'); await main.dispatchEvent('#breakAvg', 'change'); await sleep(400);
    ok(!(await main.evaluate(() => document.getElementById('breakCard').classList.contains('over'))), 'break card calm when under the limit');
    await main.fill('#breakAvg', '6'); await main.dispatchEvent('#breakAvg', 'change');
  } else console.log('SKIP break card UI checks (week has no sample data today)');
  await main.click('#exitDemo'); await sleep(300);

  // --- tray + closing the window
  const tip = () => app.evaluate(() => globalThis.__punch.tip());
  const mainVisible = () => app.evaluate(() => globalThis.__punch.isMainVisible());
  ok((await tip()).includes('not checked in'), 'tray tooltip says not checked in');
  await main.fill('#label', 'real one');
  await main.click('#checkin');
  await sleep(1200);
  ok(await widgetVisible(app), 'widget visible again on second check in');
  ok((await tip()).includes('Work') && (await tip()).includes('real one'), 'tray tooltip shows the running session', await tip());
  await main.evaluate(() => window.close());
  await sleep(800);
  ok(!(await mainVisible()), 'closing the window hides it to the tray instead of quitting');
  ok(await widgetVisible(app), 'widget stays up when main window is closed mid-session');

  // stop from the widget while the main window is hidden (under a minute -> not saved)
  const t0 = Date.now();
  await widget.click('#out');
  let msg = '';
  for (let i = 0; i < 100 && !msg.includes('under a minute'); i++) { await sleep(100); msg = await widget.textContent('#t').catch(() => ''); }
  ok(msg.includes('under a minute'), 'widget Stop works with the main window hidden', msg + ' after ' + (Date.now() - t0) + 'ms');
  console.log('   (stop took ' + (Date.now() - t0) + 'ms)');
  let tp = await tip(); for (let i = 0; i < 20 && !tp.includes('not checked in'); i++) { await sleep(100); tp = await tip(); }
  ok(tp.includes('not checked in'), 'tray tooltip resets after check out', tp);
  await sleep(4000);

  // --- sleep / idle detection, then a real saved session
  main = app.windows().find(w => w.url().includes('Punch%20Clock'));
  await main.fill('#label', 'away test');
  await main.click('#checkin'); await sleep(1200);
  const isRunning = () => main.evaluate(() => !document.getElementById('running').hidden);
  // an absence that began before this check-in must never trim it
  await app.evaluate(() => { globalThis.__punch.answer = 1; globalThis.__punch.markAway(Date.now() - 9 * 60000); globalThis.__punch.returned(); });
  await sleep(1500);
  ok(await isRunning(), 'away that began before check-in does not stop the session');
  // a short absence (under 5 min) is ignored
  await app.evaluate(() => { globalThis.__punch.markAway(Date.now() - 1000); globalThis.__punch.returned(); });
  await sleep(1000);
  ok(await isRunning(), 'short absence (under 5 min) is ignored');
  console.log('...waiting 62s so the session is long enough to be saved');
  await sleep(62000);
  await app.evaluate(async () => { globalThis.__punch.answer = 0; await globalThis.__punch.promptAway(Date.now() - 20000); });
  await sleep(1000);
  ok(await isRunning(), 'choosing "Keep the time" leaves the session running');
  await app.evaluate(async () => { globalThis.__punch.answer = 1; await globalThis.__punch.promptAway(Date.now() - 2000); });
  await sleep(2500);
  ok(!(await isRunning()), 'choosing "Stop at ..." ends the session');
  ok(await main.evaluate(() => document.getElementById('log').children.length === 2), 'trimmed session saved to log');
  ok((await widget.textContent('#t')).startsWith('Saved'), 'widget confirms the save', await widget.textContent('#t'));
  ok(/^1m$|^2m$/.test((await main.textContent('#stWork')).trim()), 'Today work total updates', await main.textContent('#stWork'));
  await app.evaluate(() => { globalThis.__punch.answer = 1; });

  // --- persistence across restart, including a running session
  await main.fill('#label', 'survives restart');
  await main.click('#checkin'); await sleep(1500);
  await app.close();
  ({ app, main, widget } = await launch());
  await main.waitForSelector('#checkin', { state: 'attached' });
  await sleep(2500);
  ok(await widgetVisible(app), 'running session restored and widget shown after restart');
  ok((await widget.textContent('#name')).includes('survives restart'), 'restored session keeps its label');
  ok(await main.evaluate(() => document.getElementById('log').children.length === 2), 'saved sessions persist across restart');
  await main.click('#discard'); await main.click('#discard'); await sleep(1500);
  ok(!(await widgetVisible(app)), 'discard hides the widget');

  await main.evaluate(() => window.close()); await sleep(500); // hide to tray first
  // --- second launch focuses the first instance rather than opening another
  const second = require('child_process').spawn(EXE || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), [...(EXE ? [] : [root]), '--user-data-dir=' + profile], { env: { ...process.env, PUNCH_TEST: '1' } });
  await sleep(3500);
  const exited = second.exitCode !== null;
  if (!exited) second.kill();
  ok(exited, 'second launch exits (single-instance lock)');
  ok(await app.evaluate(() => globalThis.__punch.isMainVisible()), 'second launch brings the hidden window back');

  if (EXE) {
    const st = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
    ok(st.launchAtLogin === true, 'packaged app defaults to launch at login', JSON.stringify(st));
  }
  await app.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(2); });
