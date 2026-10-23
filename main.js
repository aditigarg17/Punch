const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, powerMonitor, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const TEST = !!process.env.PUNCH_TEST;
const IDLE_LIMIT_S = 15 * 60;       // no keyboard/mouse for this long counts as "away"
const AWAY_MIN_MS = 5 * 60 * 1000;  // shorter absences are ignored
const startHidden = process.argv.includes('--hidden');

let mainWin = null, widget = null, tray = null, active = null, quitting = false;

/* ---------- tiny settings file (launch-at-login choice) ---------- */
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { return {}; } }
function writeSettings(patch) {
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch })); } catch (e) {}
}
function setLaunchAtLogin(on) {
  writeSettings({ launchAtLogin: on });
  if (app.isPackaged && !TEST) app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
}

/* ---------- windows ---------- */
function createMain(show = true) {
  mainWin = new BrowserWindow({
    width: 520, height: 900, title: 'Punch', show,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false // keep the nudge chime on time while hidden
    }
  });
  mainWin.loadFile('Punch Clock.html');
  // Closing the window sends Punch to the tray; use the tray menu to quit.
  mainWin.on('close', e => {
    if (!quitting) { e.preventDefault(); mainWin.hide(); }
  });
  mainWin.on('closed', () => { mainWin = null; });
}

function createWidget() {
  const { workArea } = screen.getPrimaryDisplay();
  const w = 288, h = 148;
  widget = new BrowserWindow({
    width: w, height: h, x: workArea.x + workArea.width - w - 8, y: workArea.y + 8,
    frame: false, transparent: true, hasShadow: false, resizable: false, maximizable: false,
    minimizable: false, fullscreenable: false, skipTaskbar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false
    }
  });
  widget.setAlwaysOnTop(true, 'screen-saver'); // stays above fullscreen apps too
  widget.loadFile('widget.html');
}

function showMain() {
  if (!mainWin) createMain();
  mainWin.show(); mainWin.focus();
}

/* ---------- widget state ---------- */
let widgetHold = false, holdTimer;
function hold(ms) {
  widgetHold = true; clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { widgetHold = false; if (!active && widget) widget.hide(); }, ms);
}
function pushState() {
  if (!widget || widget.isDestroyed()) return;
  widget.webContents.send('state', active);
  if (active) { if (!widget.isVisible()) widget.showInactive(); }
  else if (!widgetHold) widget.hide();
}

/* ---------- tray ---------- */
const trayImg = name => nativeImage.createFromPath(path.join(__dirname, 'build', name));
const fmtT = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
let trayTip = '';
function updateTray() {
  if (!tray) return;
  tray.setImage(trayImg(active ? 'tray-on.png' : 'tray.png'));
  tray.setToolTip(trayTip = active
    ? 'Punch: ' + (active.cat === 'work' ? 'Work' : 'Study') + (active.label ? ' · ' + active.label : '') + ', in since ' + fmtT(active.start)
    : 'Punch: not checked in');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Punch', click: showMain },
    { label: 'Check out', enabled: !!active, click: () => checkoutAt(Date.now()) },
    { type: 'separator' },
    app.isPackaged
      ? { label: 'Launch at login', type: 'checkbox', checked: !!readSettings().launchAtLogin, click: i => setLaunchAtLogin(i.checked) }
      : { label: 'Launch at login (installed app only)', enabled: false },
    { type: 'separator' },
    { label: 'Quit Punch', click: () => { quitting = true; app.quit(); } }
  ]));
}
function createTray() {
  tray = new Tray(trayImg('tray.png'));
  tray.on('click', showMain);
  updateTray();
}

/* ---------- checkout helpers ---------- */
async function checkoutAt(ms) {
  if (!mainWin) createMain(false);
  const wc = mainWin.webContents;
  // A freshly created page needs a moment to load the saved session; acting before that would be a silent no-op.
  for (let i = 0; i < 50; i++) {
    if (!wc.isLoading() && await wc.executeJavaScript('window.punchLoaded === true').catch(() => false)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  wc.executeJavaScript('window.punchCheckoutAt(' + Math.round(ms) + ')').catch(() => {});
}

/* ---------- away detection: sleep, lock screen, long inactivity ---------- */
let awaySince = null, prompting = false;
function markAway(t) { if (active && awaySince === null) awaySince = t; }
async function promptAway(since) {
  if (!active || prompting || since <= active.start) return;
  prompting = true;
  try {
    const now = Date.now(), mins = Math.round((now - since) / 60000);
    const len = mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm';
    let choice;
    if (TEST) choice = globalThis.__punch.answer;
    else {
      choice = (await dialog.showMessageBox({
        type: 'question', title: 'Punch', noLink: true, defaultId: 0, cancelId: 0,
        message: 'Still working?',
        detail: 'Your timer kept running while you were away from ' + fmtT(since) + ' to ' + fmtT(now) + ' (' + len + ').',
        buttons: ['Keep the time', 'Stop at ' + fmtT(since)]
      })).response;
    }
    if (choice === 1 && active) checkoutAt(since);
  } finally { prompting = false; }
}
function returned() {
  const since = awaySince; awaySince = null;
  if (since !== null && active && Date.now() - since >= AWAY_MIN_MS) promptAway(since);
}
function startAwayWatch() {
  powerMonitor.on('suspend', () => markAway(Date.now()));
  powerMonitor.on('lock-screen', () => markAway(Date.now()));
  powerMonitor.on('resume', returned);
  powerMonitor.on('unlock-screen', returned);
  setInterval(() => {
    if (!active) { awaySince = null; return; }
    const idle = powerMonitor.getSystemIdleTime();
    if (idle >= IDLE_LIMIT_S) markAway(Date.now() - idle * 1000);
    else if (idle < 5) returned();
  }, 15000);
}

/* ---------- IPC ---------- */
ipcMain.on('sync', (_e, a) => { active = a; if (!a) awaySince = null; pushState(); updateTray(); });
ipcMain.on('toast', (_e, m) => {
  if (!widget || widget.isDestroyed()) return;
  widget.webContents.send('toast', m);
  if (!active && /^(Saved|That was under)/.test(m)) { hold(3500); if (!widget.isVisible()) widget.showInactive(); }
});
ipcMain.on('widget-ready', pushState);
ipcMain.on('resize', (_e, h) => {
  if (widget && !widget.isDestroyed() && h > 40 && h < 400) widget.setContentSize(288, Math.round(h));
});
ipcMain.on('open-main', showMain);
ipcMain.on('checkout', () => checkoutAt(Date.now())); // the main page owns the save logic

app.on('before-quit', () => { quitting = true; });
// Stay alive in the tray when every window is hidden.
app.on('window-all-closed', () => {});

/* ---------- start ---------- */
// Only one copy at a time: a second launch just brings the first one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMain);
  app.whenReady().then(() => {
    if (app.isPackaged && readSettings().launchAtLogin === undefined) setLaunchAtLogin(true); // on by default, switch off from the tray
    createMain(!startHidden);
    createWidget();
    createTray();
    startAwayWatch();
    if (TEST) globalThis.__punch = { promptAway, markAway, returned, tip: () => trayTip, answer: 0, isMainVisible: () => !!mainWin && mainWin.isVisible() };
  });
}
