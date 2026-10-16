# Minimal Pomodoro

A desktop Pomodoro timer that collapses into a small, always-on-top floating widget (PIP mode). A React UI runs inside a transparent, frameless Tauri 2 window, and a Rust backend handles window control, notifications and screen sampling.

## Highlights
- PIP mode resizes the window to a 244×244 always-on-top widget and restores the saved physical bounds on exit.
- Auto text contrast samples the desktop behind the widget with `xcap` every 220 ms and thresholds Rec.709 luma at 150.
- On Windows the widget excludes itself from capture (`WDA_EXCLUDEFROMCAPTURE`), so it never samples its own pixels.
- The timer counts down against a wall-clock end timestamp; completion sounds are synthesized with the Web Audio API.
- Local stats (today, daily average, streak, total focus time), three themes, OS notifications, launch at startup, single instance.

## Stack
Tauri 2 · Rust · React 19 · Vite · Web Audio API · xcap

## Layout
```text
src/                 React UI, Tauri bridge, synthesized sounds
src-tauri/           Rust backend, Tauri config, app icons
pomodoro_icon.svg    Source app icon
```

## Usage
```bash
npm install            # needs Node.js and a Rust toolchain
npm run dev            # Vite dev server + Tauri window
npm run tauri:build    # NSIS installer (Windows) / DMG (macOS) in src-tauri/target/release/bundle/
```
