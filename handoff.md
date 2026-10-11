# Handoff — 10FF Auto-Type ID (Browser Extension, Chrome/Edge MV3)

Tanggal: 2026-10-11. Folder kerja: `H:\PUNYA ABID\PROJECT PRIBADI\Extension`.
Target situs: `https://10fastfingers.com/id/typing-test/indonesian`.

## Status saat ini

- `content.js` v28.0, `manifest.json` v1.20.0. Tombol floating, popup (slider 40–200 default 80), `Alt+T` toggle.
- Verifikasi lokal saat ditulis: `node --check` content/background/popup lolos,
  harness content 68/70 (2 gagal = pin `v26.0` di file harness T5, bukan regresi),
  harness background ALL PASS (B1–B10b), cek page-turn T35–T36 PASS,
  `manifest OK 1.20.0`.
- Display memakai konstanta `GOAL = 9999` sehingga tombol/popup/tooltip tampil `wN/9999`.

## Perilaku yang disepakati user

1. Lanjut mengetik selama waktu tes tersisa; tidak berhenti di tengah sebelum waktu habis.
2. Hasil WPM tidak harus sama persis dengan setting, tapi tidak boleh di bawah setting.
3. Tidak ada stuck di tengah (49/9999 merah-diam tidak boleh terjadi lagi).
   Reset `wi` hanya untuk adopsi halaman baru (page-turn), display tetap naik via
   counter absolut `absDone` sehingga tombol/popup tidak terlihat balik ke 1/9999.
4. v28: perbaiki salah massal setelah kata-10. `refill()` hanya extend/scroll
   bila posisi sama atau anchor 2-kata (`findAnchor`) cocok; adopsi halaman
   butuh 5x miss + 0 overlap 5 kata berikut (`page-turn blocked` bila overlap).
   `submit-skip` dihapus (retry kata yang sama, skip menggeser semua kata
   berikut jadi merah). Re-parse hanya tiap awal kata (`ci==0`).

## File dan peran

- `manifest.json` — MV3, permissions `activeTab, scripting, storage, debugger`,
  content script `content.js` (`document_idle`), popup `popup.html`, command `Alt+T`.
- `content.js` — seluruh logika: selektor `data-testid` (`word-box-words`,
  `Typing-box-input`), `execCommand('insertText')` + `keydown/keypress/keyup` pendamping,
  fallback `chrome.debugger` (`Input.insertText` + `dispatchKeyEvent`), verifikasi isi
  eksak per huruf (`boxExp`), commit-verified submit (spasi = box harus kosong),
  retry 3x per huruf, refill aman, pacing closed-loop + floor.
- `background.js` — relay `chrome.debugger` (attach, `DBG_KEY`, `DBG_CLICK`, release)
  + command `Alt+T` → `TOGGLE` (hanya di tab 10fastfingers, `.catch(() => {})`).
- `popup.html` / `popup.js` — slider WPM, tombol Start/Stop, label progres `wN/GOAL`,
  pesan `Reload halaman lalu coba lagi` bila content script belum ter-load.
- Snippet CLI (`snippet save all -f <file> -t ff10-*`): `ff10-content`,
  `ff10-background`, `ff10-manifest`, `ff10-popup`, `ff10-popup-html`.
  Terakhir disimpan: v26/manifest 1.18.0 — v28 BELUM disimpan ulang, jalankan snippet save.
  Go portable di `%LOCALAPPDATA%\go-portable`,
  binary di `%USERPROFILE%\go\bin\snippet.exe` (sudah di PATH user).

## Harness dan cara uji lokal

- Content: `node "$env:LOCALAPPDATA\Temp\opencode\ff10-harness.js" "H:\PUNYA ABID\PROJECT PRIBADI\Extension\content.js"`
  (butuh ~1–2 menit; T10/T22 menunggu timeout/attach).
  Catatan: T5 pin `v26.0` di file harness sehingga 2 cek gagal di v27 — bukan regresi.
- Page-turn v27: `node "$env:LOCALAPPDATA\Temp\opencode\ff10-v27-check.js"`
  (T35 adopsi halaman disjoint, T36 exhaustion adopsi, T37 versi/absolut).
- Background: `node "$env:LOCALAPPDATA\Temp\opencode\ff10-bg-harness.js" "H:\PUNYA ABID\PROJECT PRIBADI\Extension\background.js"`.
- `node --check content.js|background.js|popup.js`, `python -c "import json;..."` untuk manifest.
- Hook debug di tab tes (Console): `__ff10.state()` (ada `absDone`), `__ff10.diag()`
  (berisi `trace`, `boxExp`, `stuck`, `refillMiss`, `absDone`, `submitAgoMs`),
  `__ff10.probe()`, `await __ff10.probeDbg()`.

## Cara tes di browser (wajib berurutan)

1. `chrome://extensions` → Reload extension ini.
2. Tutup DevTools di tab tes (debugger tidak bisa attach saat DevTools terbuka).
3. Ctrl+Shift+R tab Indonesian.
4. Console wajib `[10FF] content v28.0 loaded`. Kalau masih versi lama, ulangi 1–3.
5. `await __ff10.probeDbg()` → `{ok:true}` + banner kuning muncul-hilang.
   Kalau `{ok:false}`, kirim field `error`-nya.
6. Klik ▶ Type. Harus: tombol merah `■ N/9999 <live>wpm`, banner debugger, huruf jalan,
   `state()` `mode:"dbg"`, `wi`/`ticks` naik. Tombol oranye = vonis pasti
   (`No word-box`, `No textarea`, `No words (N)`, `Textarea locked`,
   `Blocked wN/total [mode]`, `Close DevTools!`) — kirim teksnya + `__ff10.diag()`.

## History singkat (agar tidak mengulang)

- v1–v3: selektor tebakan (`#inputfield`, `#row1`) → abort diam. Dump DOM user
  membuktikan target = `<TEXTAREA data-testid="Typing-box-input">` + box
  `[data-testid="word-box-words"]`, situs Next.js + guard `isTrusted`.
- v4–v9: `execCommand` + fallback debugger + `trustedClick` via `DBG_CLICK`.
- v10–v17: `sendBg` timeout 2,5 dtk, `busy` guard startup, sleep ladder
  (`sleepWhile`), `boxExp` exact-verify, `refill` aman, `actualWpm`.
- v18–v22: pacing floor, `exhaustAt` 65 dtk, GOAL display, rescue-tanpa-stop.
- v23: GOAL 9999 di semua display + `state`/`reply` bawa `goal`.
- v24: verifikasi + snippet.
- v25: tidak ada perubahan fungsi (cek disk: tidak ada penanda v25 di file).
- v26: hapus SEMUA reset otomatis ke kata-1. `wi`/`ci` hanya maju pada
  keystroke terverifikasi atau `submit-skip` keep-alive; tidak pernah mundur ke 0
  kecuali user menekan Stop/Start. Exhaustion dan rescue = WAIT di posisi.
  Harness T34 (`no rewind on swap`) menutup regresi ini.
- v27: perbaiki stuck merah-diam 49/9999. HOLD selamanya diganti adopsi:
  `page-turn` (3x miss + list ≥10 kata), `rows-adopt` + refocus di `wait-rows`,
  `submit-skip >3`. `wi` halaman boleh 0 ulang tapi display absolut `absDone`
  tetap naik. `exhaustAt` mati dihapus. Harness T35–T37 menutup regresi ini.
- v28 (aktif): perbaiki salah massal setelah kata-10 (adopsi v27 terlalu agresif:
  `indexOf` kata tunggal lompat ke kembaran kata umum, `skip` menggeser semua
  kata berikut). Sekarang anchor 2-kata, adopsi butuh 5x miss + 0 overlap,
  tanpa skip, re-parse tiap awal kata. `rows-adopt` tanpa syarat dihapus.

## Ditemukan tapi belum dikerjakan

- `background.js` memakai `Input.dispatchKeyEvent` + `Input.insertText` per huruf;
  bila situs suatu saat menolak `insertText`, satu-satunya jalur tersisa adalah
  key-event murni per huruf (lebih lambat, WPM turun).
- File harness `ff10-harness.js` masih pin `v26.0` di T5 (2 cek gagal di v27) —
  selaraskan ke `V` dinamis saat sentuh harness lagi.
- Snippet `ff10-*` masih v26/manifest 1.18.0 — simpan ulang untuk v27/1.19.0.
- `popup.html` tidak berubah sejak awal; slider max 200 — user belum minta naik.
- Lapisan iklan/Mediavine diblokir adblock (`ERR_BLOCKED_BY_CLIENT`) — noise,
  bukan error extension. Error `colyseus.js refresh-list` juga noise iklan.
