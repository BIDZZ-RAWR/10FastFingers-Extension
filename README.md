# 10FF Auto-Type ID

Auto-typing helper (Chrome/Edge MV3) for `https://10fastfingers.com/id/typing-test/indonesian`.

## Install

1. `chrome://extensions` → Developer mode → Load unpacked → pilih folder ini.
2. Buka tab Indonesian typing test, Ctrl+Shift+R.
3. Console harus `[10FF] content v28.0 loaded`.

## Pakai

- Tombol floating ▶ Type / ■ Stop di kanan bawah, atau popup slider 40–200 WPM (default 80), atau `Alt+T`.
- Tutup DevTools di tab tes (debugger tidak bisa attach saat DevTools terbuka).
- Jalur utama: `execCommand('insertText')` + key event pendamping; fallback `chrome.debugger` (`Input.insertText` + `dispatchKeyEvent`) bila `isTrusted` guard menolak.

## File

- `manifest.json` — MV3, permissions `activeTab, scripting, storage, debugger`, content script `document_idle`, command `Alt+T`.
- `content.js` — seluruh logika: parse kata, exact-verify per huruf (`boxExp`), commit-verified submit, refill aman (anchor 2-kata), pacing floor.
- `background.js` — relay `chrome.debugger` (attach, `DBG_KEY`, `DBG_CLICK`, release) + `Alt+T` → `TOGGLE`.
- `popup.html` / `popup.js` — slider WPM, Start/Stop, label progres `wN/9999`.

## Debug

Console di tab tes: `__ff10.state()`, `__ff10.diag()`, `__ff10.probe()`, `await __ff10.probeDbg()`.
