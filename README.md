# 10FF Auto-Type ID

A Chrome / Edge (Manifest V3) extension that automates typing on the 10FastFingers Indonesian typing test:

`https://10fastfingers.com/id/typing-test/indonesian`

It drives the site's own input pipeline — synthetic keystrokes, per-character verification, and word-commit detection — with a trusted debugger fallback for pages that reject synthetic events.

> **Note:** a yellow *“is debugging this browser”* banner is expected while typing. It is shown by Chrome whenever the `debugger` permission is active and disappears on stop.

## Features

- One-click start/stop via floating button, popup, or `Alt+T` shortcut
- Adjustable pace: 40–200 WPM (default 80), persisted in `chrome.storage`
- Dual input pipeline:
  - Primary: `insertText` + companion `keydown` / `keypress` / `keyup`
  - Fallback: `chrome.debugger` (`Input.insertText` + `Input.dispatchKeyEvent`)
- Exact-match verification per character — no blind length checks
- Commit-verified word submit (a word counts only when the page clears the box)
- Automatic retry (3x per character) and resync on rejected words — no word skipping
- Safe word-list refill with 2-word sequence anchoring for row scrolls and page turns
- Closed-loop pacing so measured WPM never drops below the configured floor
- Live progress display (`wN/9999` + live WPM) on the button, popup, and tooltip
- Autoplay on page load once the word box is ready, plus a keep-alive watchdog

## Requirements

- Google Chrome or Microsoft Edge (Manifest V3 support)
- Access to `10fastfingers.com`
- Closed DevTools on the test tab (Chrome blocks `debugger` attach while DevTools is open)

## Installation

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open the Indonesian typing test page and hard-reload (`Ctrl+Shift+R`).
5. Confirm the console prints `[10FF] content v28.0 loaded`.

## Usage

| Method | Action |
|---|---|
| Floating button (bottom-right) | ▶ Type / ■ Stop |
| Extension popup | WPM slider + Start / Stop |
| Keyboard | `Alt+T` toggles typing (test tab only) |

1. Close DevTools on the test tab.
2. Click **▶ Type** (or press `Alt+T`).
3. The button turns red (`■ N/9999 <live>wpm`) while typing.
4. Click again or press `Alt+T` to stop. The debugger detaches automatically.

Orange button states are hard verdicts — e.g. `No word-box`, `No textarea`, `Textarea locked`, `Blocked wN/total [mode]`, `Close DevTools!`.

## How It Works

- `content.js` — all typing logic: word-box parsing, input focus management, exact-content verification (`boxExp`), commit-verified submit, safe refill, and floor pacing.
- `background.js` — service worker relaying `chrome.debugger` (`attach`, `Input.dispatchKeyEvent`, `Input.insertText`, `Input.dispatchMouseEvent`, `detach`) plus the `Alt+T` → `TOGGLE` command.
- `popup.html` / `popup.js` — WPM slider, Start/Stop button, progress label, and content-script state sync.
- `manifest.json` — MV3 wiring: `activeTab`, `scripting`, `storage`, `debugger` permissions, `document_idle` content script, and the `toggle-typing` command.

Word commits are acknowledged by the page clearing the input box. A submit that does not clear within ~1s is treated as rejected: the box is wiped and the same word is retried from scratch.

## Project Structure

```text
.
├── manifest.json   # MV3 manifest, permissions, commands
├── content.js      # Typing engine (injected into 10fastfingers)
├── background.js   # Debugger relay service worker
├── popup.html      # Popup UI
├── popup.js        # Popup logic
└── handoff.md      # Internal development notes
```

## Configuration

| Setting | Range | Default | Stored in |
|---|---|---|---|
| WPM | 40–200 | 80 | `chrome.storage.local` |

WPM changes apply live via the popup slider and take effect on the next keystroke gap.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Reload halaman lalu coba lagi` in popup | Content script not loaded yet | Hard-reload the test tab, then reload the extension |
| `Close DevTools!` | DevTools blocks debugger attach | Close DevTools on the test tab and restart |
| `No word-box` / `No words (N)` | Word list not rendered yet | Wait for the page to finish loading, then start |
| `Textarea locked` / `Click ignored` | Input not focusable (banner overlay) | Click the test box once, then start again |
| `Blocked wN/total [exec]` | Debugger denied, synthetic path rejected | Run `await __ff10.probeDbg()` and report the `error` field |
| Old version in console | Stale content script | Reload extension → close DevTools → `Ctrl+Shift+R` |

Console hooks (on the test tab): `__ff10.state()`, `__ff10.diag()`, `__ff10.probe()`, `await __ff10.probeDbg()`.

## Development

```powershell
node --check content.js
node --check background.js
node --check popup.js
python -c "import json; json.load(open('manifest.json')); print('manifest OK')"
```

Internal regression harnesses and version history are documented in `handoff.md`.

## Version

- Extension: `1.20.0` (`manifest.json`)
- Typing engine: `v28.0` (`content.js`)
