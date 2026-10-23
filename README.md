# Punch

**Not your ordinary productivity app.**

A tiny desktop time tracker that refuses to let you forget it is running.

Check in to **Work** or **Study**, and a small always-on-top timer follows you around your screen until you check out.
Everything stays on your machine: no account, no server, no API calls.

## Features

- **Floating timer** that stays on top of every window, turns red when you have been going longer than your reminder interval, and shows a rotating focus quote.
- **Sleep and idle detection.** Close the laptop or walk away for 15+ minutes and Punch asks whether to *keep the time* or *stop at the moment you left*.
- **Tray icon** (green dot while running), launch at login, and a single-instance lock.
- **Analytics**: today vs your daily goal, last 7 days, peak hours, streak, and **Week / Month / Year reports** with work/study split, average per day, goal-met days and best day.
- **Weekend break nudge**: if your weekly average passes a limit you choose, Punch tells you that you deserve a break.
- Add sessions you forgot to log, remove sessions, dark mode.

## Install (Windows)

Download `Punch Setup x.y.z.exe` from the Releases page and run it. It installs per-user (no admin rights).
The installer is unsigned, so Windows SmartScreen may warn: choose **More info, Run anyway**.

## Run from source

```bash
npm install
npm start
```

Requires Node 20+.

```bash
npm test         # end-to-end tests (launches the real app on a throwaway profile, ~2.5 min)
npm run dist     # build the Windows installer into dist/
npm run icons    # regenerate the icons in build/
```

To test a packaged build: `PUNCH_EXE=path/to/Punch.exe npm test`.

## How it works

- Electron app: `main.js` (windows, tray, sleep/idle detection), `Punch Clock.html` (the whole UI and analytics, plain JS) and `widget.html` (the floating timer).
- Sessions are stored as small records (type, start, end, label) in the app's local storage under `%APPDATA%\Punch`.
  Every chart and report is computed from those records on the fly.

## Privacy

No telemetry and no network calls, with one exception: the page loads three fonts from Google Fonts.

## License

MIT
