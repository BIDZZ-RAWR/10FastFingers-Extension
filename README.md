<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&pause=1000&color=27AE60&center=true&vCenter=true&width=600&lines=10FF+Auto-Type+ID;Exact+verify.+No+skips.;Floor+pacing%2C+never+below+setting." alt="10FF Auto-Type ID" />

<p>Chrome / Edge (Manifest V3) extension that automates typing on the 10FastFingers Indonesian typing test.</p>

![version](https://img.shields.io/badge/version-1.20.0-27ae60?style=flat-square)
![engine](https://img.shields.io/badge/engine-v28.0-2c3e50?style=flat-square)
![manifest](https://img.shields.io/badge/manifest-V3-0969da?style=flat-square)
![browser](https://img.shields.io/badge/Chrome_%2F_Edge-supported-e67e22?style=flat-square)

</div>

> A yellow "is debugging this browser" banner is normal while typing. Chrome shows it whenever the `debugger` permission is active, and it disappears on stop.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Version](#version)

## Features

- Start and stop from the floating button, the popup, or `Alt+T`
- Pace control from 40 to 200 WPM (default 80), saved in `chrome.storage`
- Two input paths. Primary is `insertText` with companion key events. Fallback is `chrome.debugger` for pages that reject synthetic events
- Per character check against the expected buffer, so wrong characters are caught instead of counted by length
- Word submit counts only when the page clears the box. A submit that does not clear within about 1s is wiped and the same word is retried, never skipped
- Retry up to 3x per character, with resync on rejected words
- Word list refill anchored on 2 word sequences, so row scrolls and page turns do not shift the cursor
- Pacing floor keeps measured WPM at or above the configured value
- Live progress (`wN/9999` plus live WPM) on the button, the popup, and the tooltip
- Autoplay once the word box is ready, plus a watchdog that restarts a wedged loop

## Requirements

- Google Chrome or Microsoft Edge with Manifest V3 support
- Access to `10fastfingers.com`
- DevTools closed on the test tab. Chrome refuses `debugger` attach while DevTools is open

## Installation

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Open the Indonesian typing test page and hard reload (`Ctrl+Shift+R`)
5. Confirm the console prints `[10FF] content v28.0 loaded`

## Usage

| Method | Action |
|---|---|
| Floating button, bottom right | Type / Stop |
| Extension popup | WPM slider plus Start / Stop |
| Keyboard | `Alt+T` toggles typing on the test tab |

1. Close DevTools on the test tab
2. Click **Type** (or press `Alt+T`)
3. The button turns red and shows progress while typing
4. Click again (or press `Alt+T`) to stop. The debugger detaches by itself

An orange button means a hard stop with a reason shown on the button, for example `No word-box`, `No textarea`, `Textarea locked`, `Blocked wN/total [mode]`, or `Close DevTools!`.

## How it works

| File | Role |
|---|---|
| `content.js` | Typing engine. Parses the word box, manages focus, verifies each character (`boxExp`), confirms every word submit, refills the word list safely, and paces keystrokes |
| `background.js` | Service worker relay for `chrome.debugger` (attach, key events, text insert, mouse click, detach) and the `Alt+T` toggle |
| `popup.html` / `popup.js` | WPM slider, Start / Stop button, progress label, state sync with the content script |
| `manifest.json` | MV3 wiring. Permissions `activeTab`, `scripting`, `storage`, `debugger`. Content script at `document_idle`. Command `toggle-typing` |

The page acknowledges a submitted word by clearing the input box. No clear means no accept, so the engine wipes the box and retypes the same word from the first character.

## Project structure

```text
.
├── manifest.json   # MV3 manifest, permissions, commands
├── content.js      # Typing engine injected into 10fastfingers
├── background.js   # Debugger relay service worker
├── popup.html      # Popup UI
├── popup.js        # Popup logic
└── handoff.md      # Internal development notes
```

## Configuration

| Setting | Range | Default | Stored in |
|---|---|---|---|
| WPM | 40-200 | 80 | `chrome.storage.local` |

Slider changes apply live and take effect on the next keystroke gap.

## Troubleshooting

<details>
<summary>Popup says "Reload halaman lalu coba lagi"</summary>

The content script is not loaded yet. Hard reload the test tab, then reload the extension.

</details>

<details>
<summary>Button shows "Close DevTools!"</summary>

DevTools blocks debugger attach. Close DevTools on the test tab and start again.

</details>

<details>
<summary>Button shows "No word-box" or "No words (N)"</summary>

The word list has not rendered yet. Wait for the page to finish loading, then start.

</details>

<details>
<summary>Button shows "Textarea locked" or "Click ignored"</summary>

The input is not focusable, usually because a banner overlays it. Click the test box once, then start again.

</details>

<details>
<summary>Button shows "Blocked wN/total [exec]"</summary>

The debugger was denied and the synthetic path was rejected. Run `await __ff10.probeDbg()` in the tab console and report the `error` field.

</details>

<details>
<summary>Console shows an old version</summary>

A stale content script is cached. Reload the extension, close DevTools, then `Ctrl+Shift+R`.

</details>

<details>
<summary>Console hooks (run on the test tab)</summary>

```js
__ff10.state()            // typing, wpm, cursor, mode, live wpm
__ff10.diag()             // trace, boxExp, stuck, refillMiss, focus state
__ff10.probe()            // synthetic insert check on a scratch textarea
await __ff10.probeDbg()   // fresh debugger attach verdict, nothing left attached
```

</details>

## Development

```powershell
node --check content.js
node --check background.js
node --check popup.js
python -c "import json; json.load(open('manifest.json')); print('manifest OK')"
```

Regression harnesses and version history live in `handoff.md`.

## Version

- Extension `1.20.0` (`manifest.json`)
- Typing engine `v28.0` (`content.js`)
