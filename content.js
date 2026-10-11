(() => {
  const V = "28.0";
  const GOAL = 9999;
  if (window.__ff10v === V) return;
  window.__ff10v = V;
  try { if (window.__ff10obs) window.__ff10obs.disconnect(); } catch (e) {}
  document.getElementById("__ff10btn")?.remove();

  const TIMEOUT_MS = 2500;

  let typing = false;
  let busy = false;
  let wpm = 80;
  let timer = null;
  let words = [];
  let wi = 0;
  let ci = 0;
  let ticks = 0;
  let lastTickAt = 0;
  let btn = null;
  let lastError = "";
  let mode = "exec";
  let dbgOk = null;
  let dbgErr = "";
  const trace = [];
  let clicks = 0;
  let clears = 0;
  let presses = 0;
  let retries = 0;
  let lastKey = "";
  let boxExp = "";
  let stuck = 0;
  let paceBoost = 0.95;
  let winStart = 0;
  let winClean = true;
  let refillMiss = 0;
  let nextDue = 0;
  let typeStart = 0;
  let lastSubmitAt = 0;
  let typedChars = 0;
  let absDone = 0;
  let needClear = false;

  function note(s) {
    try {
      trace.push(Date.now() + " " + s);
      if (trace.length > 40) trace.shift();
    } catch (e) {}
  }

  function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  // Plain delay, focus loss (popup opened, user clicks around) never pauses typing.
  async function gated(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (!typing) return false;
      await sleep(Math.min(100, end - Date.now()));
    }
    return typing;
  }

  // Single poll shared by waitCleared/waitClear/waitSubmit: page ACKs by clearing the box.
  async function waitForClear(input, tries, gap) {
    for (let i = 0; i < tries; i++) {
      if (!input.value.length) return true;
      if (!(await sleepWhile(gap))) return !input.value.length;
    }
    return !input.value.length;
  }

  // Commit check for space: the page ACKs a submitted word by clearing the box.
  async function waitCleared(input) {
    return waitForClear(input, 16, 25);
  }

  // After word submit the page clears async, a lingering value is normal, not failure.
  async function waitClear(input) {
    await waitForClear(input, 8, 15);
  }

  // Commit-verified submit: the page must ACK by clearing the box within ~1s.
  // Timeout = word NOT accepted. We wipe (resync) so the SAME word can retry;
  // a wipe is never an ACK, so this path always returns ok:false.
  async function waitSubmit(input) {
    if (await waitForClear(input, 40, 25)) { boxExp = ""; return { ok: true }; }
    if (!typing && !busy) return { ok: false, stopped: true };
    note("submit-timeout w" + (wi + 1) + " val=" + input.value.length);
    return { ok: false };
  }

  // Single Backspace wipe loop shared by resync/trustedClear.
  async function dbgBackspace(input) {
    for (let i = 0; i < 50 && input.value; i++) {
      if (!typing && !busy) return false;
      try { input.setSelectionRange(0, input.value.length); } catch (e) {}
      const r = await sendBg({ type: "DBG_KEY", key: "Backspace", code: "Backspace", vk: 8 });
      if (!r.ok) break;
      if (!(await sleepWhile(15))) return false;
    }
    return true;
  }

  // Resync on a rejected word: wipe the box and retype the SAME word from ci=0.
  // boxExp follows the wipe so the next verify compares against a clean buffer.
  async function resync(input, word) {
    note("resync w" + (wi + 1) + " '" + word + "'");
    input.focus();
    try { input.setSelectionRange(0, input.value.length); } catch (e) {}
    if (await ensureDbg()) {
      if (!(await dbgBackspace(input))) return false;
    } else {
      try {
        input.setSelectionRange(0, input.value.length);
        document.execCommand("delete");
      } catch (e) {}
    }
    await waitClear(input);
    const clean = !input.value.length;
    if (clean) boxExp = "";
    note("resync:" + (clean ? "clean" : "STUCK len=" + input.value.length));
    ci = 0;
    return clean;
  }

  chrome.storage.local.get({ wpm: 80 }, (r) => { wpm = clampWpm(r.wpm); });

  function clampWpm(v) {
    v = parseInt(v, 10);
    if (isNaN(v)) return 80;
    return Math.min(200, Math.max(40, v));
  }

  // Floor pacing: early chars use the IDEAL gap (never slower than setting),
  // then a 10s rolling window tightens gaps so measured WPM never drops below wpm.
  function idealGap() {
    return (12000 / wpm) * (0.8 + Math.random() * 0.4);
  }

  function floorGap() {
    return 12000 / wpm;
  }

  // Catch-up: a stalled loop restarts from its due time (burst to recover),
  // a healthy loop uses ideal spacing. nextDue is the single clock.
  function scheduleFloor() {
    const now = Date.now();
    if (!winStart) { winStart = now; winClean = true; }
    if (now - winStart >= 10000) {
      if (!winClean && paceBoost > 0.5) {
        paceBoost = Math.max(0.5, paceBoost - 0.1);
        note("pace-boost x" + paceBoost.toFixed(2));
      } else if (winClean && paceBoost < 0.95) {
        paceBoost = Math.min(0.95, paceBoost + 0.05);
      }
      winStart = now;
      winClean = true;
    }
    if (!nextDue || nextDue < now - 2000) nextDue = now + floorGap();
    else nextDue += idealGap() * paceBoost;
    return Math.max(0, nextDue - Date.now());
  }

  // Startup runs under busy (typing not yet true), so busy also keeps waits alive.
  function sleepWhile(ms) {
    return (async () => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (!typing && !busy) return false;
        await sleep(Math.min(50, end - Date.now()));
      }
      return typing || busy;
    })();
  }

  function sendBg(msg) {
    return new Promise((res) => {
      let done = false;
      const to = setTimeout(() => {
        if (!done) { done = true; res({ ok: false, error: "bg-timeout" }); }
      }, TIMEOUT_MS);
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          if (done) return;
          done = true;
          clearTimeout(to);
          if (chrome.runtime.lastError) res({ ok: false, error: chrome.runtime.lastError.message });
          else res(r || { ok: false, error: "no-reply" });
        });
      } catch (e) {
        if (!done) { done = true; clearTimeout(to); res({ ok: false, error: String(e).slice(0, 80) }); }
      }
    });
  }

  async function ensureDbg() {
    if (dbgOk === true) return true;
    if (dbgOk === false) return false;
    const r = await sendBg({ type: "DBG_ENSURE" });
    dbgOk = !!r.ok;
    mode = dbgOk ? "dbg" : "exec";
    if (!dbgOk) dbgErr = r.error || "dbg-denied";
    return dbgOk;
  }

  function getBox() {
    const exact = document.querySelector('[data-testid="word-box-words"]');
    if (exact && exact.querySelectorAll("span").length >= 10) return exact;
    let best = null;
    let bestCount = 0;
    for (const d of document.querySelectorAll("div")) {
      if (d.querySelector("textarea, input, button")) continue;
      const spans = d.querySelectorAll(":scope > span");
      if (spans.length < 20 || spans.length > 150) continue;
      let ok = 0;
      let alpha = 0;
      for (let i = 0; i < Math.min(spans.length, 10); i++) {
        const t = (spans[i].textContent || "").trim();
        if (t && !/\s/.test(t) && t.length <= 20) ok++;
        if (/[a-zA-Z\u00c0-\u024f]/.test(t)) alpha++;
      }
      if (ok >= 7 && alpha >= 5 && spans.length > bestCount) { best = d; bestCount = spans.length; }
    }
    return best;
  }

  function getInput() {
    return document.querySelector('textarea[data-testid="Typing-box-input"]')
      || document.querySelector("textarea");
  }

  // Strict lowercase wins whenever it parses (leaderboards inflate the loose list).
  function split(t, re) {
    return (t || "").split(/[\s|]+/).map((x) => x.trim()).filter((x) => re.test(x));
  }
  const RE_STRICT = /^[a-z\u00e0-\u00ff'-]{1,24}$/;
  const RE_LOOSE = /^[A-Za-z\u00c0-\u024f'-]{1,24}$/;

  function parseWords(box) {
    let inner = "";
    try { inner = box.innerText || ""; } catch (e) {}
    const text = box.textContent || "";
    const strict = [split(inner, RE_STRICT), split(text, RE_STRICT)].sort((a, b) => b.length - a.length)[0];
    if (strict.length >= 10) return strict;
    const loose = [split(inner, RE_LOOSE), split(text, RE_LOOSE)].sort((a, b) => b.length - a.length)[0];
    if (loose.length >= 10) return loose;
    return strict.length >= loose.length ? strict : loose;
  }

  function getWords() {
    const box = getBox();
    if (!box) return { words: [], why: "No word-box" };
    const t = parseWords(box);
    if (t.length < 10) return { words: [], why: "No words (" + t.length + ")" };
    return { words: t.slice(0, 9999), why: "" };
  }

  function keyCodeFor(key) {
    if (key === " ") return 32;
    if (key.length === 1) return key.toUpperCase().charCodeAt(0);
    return 0;
  }

  function codeFor(key) {
    if (key === " ") return "Space";
    if (/^[a-zA-Z]$/.test(key)) return "Key" + key.toUpperCase();
    if (/^[0-9]$/.test(key)) return "Digit" + key;
    return "";
  }

  function fakeKey(target, type, key) {
    const kc = keyCodeFor(key);
    const ev = new KeyboardEvent(type, {
      key, code: codeFor(key), bubbles: true, cancelable: true, composed: true
    });
    try {
      Object.defineProperty(ev, "keyCode", { value: kc });
      Object.defineProperty(ev, "which", { value: kc });
      Object.defineProperty(ev, "charCode", { value: type === "keypress" ? kc : 0 });
    } catch (e) {}
    target.dispatchEvent(ev);
  }

  // Trusted mouse click drives the site start path (banner dismiss + focus).
  async function trustedClick(el, tag) {
    clicks++;
    note("click:" + tag);
    if (!el) { note("click-miss:" + tag); return false; }
    const t0 = Date.now();
    if (await ensureDbg()) {
      try {
        const r = el.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        const ok = await sendBg({ type: "DBG_CLICK", x, y });
        if (ok && ok.ok) { note("clicked:" + tag + "+" + (Date.now() - t0) + "ms"); return true; }
      } catch (e) { note("click-err:" + tag); }
      dbgOk = false;
      mode = "exec";
    }
    try { el.click(); } catch (e) {}
    note("clicked-fallback:" + tag);
    return true;
  }

  async function awaitFocus(input, tag) {
    if (document.activeElement === input) return true;
    for (let i = 0; i < 40; i++) {
      if (document.activeElement === input) return true;
      try { input.focus(); } catch (e) {}
      if (document.hasFocus && !document.hasFocus()) break;
      if (!(await sleepWhile(50))) return document.activeElement === input;
    }
    note("unfocused:" + tag);
    return document.activeElement === input;
  }

  async function trustedClear(input) {
    clears++;
    note("clear:start len=" + (input.value ? input.value.length : 0));
    if (!input.value) { note("clear:empty"); return true; }
    input.focus();
    if (await ensureDbg()) {
      if (!(await dbgBackspace(input))) return false;
      if (!input.value) { note("clear:ok-dbg"); return true; }
      dbgOk = false;
      mode = "exec";
    }
    try {
      input.setSelectionRange(0, input.value.length);
      document.execCommand("delete");
    } catch (e) {}
    const ok = !input.value;
    note("clear:" + (ok ? "ok-exec" : "FAIL len=" + input.value.length));
    return ok;
  }

  function blockMsg() {
    if (mode === "exec" && /attach|devtools|debugger/i.test(dbgErr)) return "Close DevTools!";
    return "Blocked w" + (wi + 1) + "/" + words.length + " [" + mode + "]";
  }

  // Exact-content typing: the box must equal our expected buffer after each char.
  // Length-only checks are blind to wrong chars; content comparison is not.
  async function boxStable(input) {
    let prev = input.value;
    let same = 0;
    for (let i = 0; i < 10; i++) {
      if (!typing) return prev;
      if (!(await sleepWhile(15))) return prev;
      const cur = input.value;
      if (cur !== prev) { prev = cur; same = 0; continue; }
      if (++same >= 2) return cur;
    }
    return prev;
  }

  // Up to 3 tries per char: real insert that the page reverts is retried before failing.
  async function pressChar(input, key) {
    presses++;
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) retries++;
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
      if (await ensureDbg()) {
        const want = boxExp + key;
        const r = await sendBg({ type: "DBG_KEY", key, code: codeFor(key), vk: keyCodeFor(key) });
        if (!typing) return false;
        if (r.ok) {
          if (key === " ") {
            if (await waitCleared(input)) { boxExp = ""; return true; }
            if (!typing) return false;
            note("space-stuck-dbg w" + (wi + 1) + " a" + attempt);
          } else {
            const got = await boxStable(input);
            if (!typing) return false;
            if (got === want) { boxExp = want; return true; }
            note("dbg-mismatch exp=" + JSON.stringify(want) + " got=" + JSON.stringify(got) + " a" + attempt);
          }
        } else {
          dbgOk = false;
          mode = "exec";
        }
      }
      const want = boxExp + key;
      fakeKey(input, "keydown", key);
      fakeKey(input, "keypress", key);
      let ok = false;
      try { ok = document.execCommand("insertText", false, key); } catch (e) { ok = false; }
      fakeKey(input, "keyup", key);
      if (!(await sleepWhile(30))) return false;
      if (key === " ") {
        if (!!ok && await waitCleared(input)) { boxExp = ""; return true; }
        note("space-stuck-exec w" + (wi + 1) + " a" + attempt);
      } else {
        const got = await boxStable(input);
        if (got === want && !!ok) { boxExp = want; return true; }
        note("retry:" + key + " exp=" + JSON.stringify(want) + " got=" + JSON.stringify(got) + " a" + attempt);
      }
      if (!(await sleepWhile(60))) return false;
    }
    return false;
  }

  // Same first words = same page (parse wobble, not a new page).
  function samePage(a, b) {
    const n = Math.min(5, a.length, b.length);
    if (!n) return false;
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // 2-word sequence anchor: single common words ("yang", "dan") repeat, so a
  // lone indexOf jumps to the wrong twin and every word after goes red.
  // Only a cur+next (or cur+prev at the tail) pair may steer the cursor.
  function findAnchor(fresh, old, wi) {
    const cur = old[wi];
    if (!cur) return -1;
    const nxt = old[wi + 1] || null;
    const prv = wi > 0 ? old[wi - 1] : null;
    for (let j = 0; j < fresh.length; j++) {
      if (fresh[j] !== cur) continue;
      if (nxt && fresh[j + 1] === nxt) return j;
      if (!nxt && prv && j > 0 && fresh[j - 1] === prv) return j;
      if (!nxt && !prv) return j;
    }
    return -1;
  }

  // Refill keeps the run alive but never steers on a guess: extend/scroll only
  // on positional or sequence anchor; adopt a new page only on disjoint
  // evidence (5x missing + none of the next 5 words present). A wrong adopt
  // shifts every later word by one and the whole run goes red from ~w10 on.
  function refill() {
    const r = getWords();
    if (!r.words.length) return false;
    if (wi >= words.length) {
      if (r.words.length > words.length && samePage(r.words, words)) {
        note("refill extend-end n=" + words.length + "->" + r.words.length);
        words = r.words;
        refillMiss = 0;
        return true;
      }
      if (r.words.length >= 10 && !samePage(r.words, words)) {
        refillMiss++;
        note("refill-wait:rows-missing miss#" + refillMiss);
        if (refillMiss >= 3) {
          note("rows-page adopt n=" + r.words.length + " abs=" + absDone);
          words = r.words;
          wi = 0;
          ci = 0;
          boxExp = "";
          needClear = true;
          refillMiss = 0;
          return true;
        }
        return false;
      }
      refillMiss = 0;
      return false;
    }
    if (r.words[wi] === words[wi]) {
      if (r.words.length > words.length && samePage(r.words, words)) {
        note("refill extend n=" + words.length + "->" + r.words.length + " keep w" + (wi + 1));
        words = r.words;
        refillMiss = 0;
        return true;
      }
      refillMiss = 0;
      return false;
    }
    const at = findAnchor(r.words, words, wi);
    if (at >= 0) {
      if (r.words.length === words.length && samePage(r.words, words)) {
        note("refill dup-guard w" + (wi + 1));
        refillMiss = 0;
        return false;
      }
      if (at > wi + 1) { note("refill-skip:cur-shifted w" + (wi + 1) + "->" + (at + 1)); refillMiss = 0; return false; }
      note("refill-scroll drop=" + (wi - at) + " w" + (wi + 1) + "->" + (at + 1));
      words = r.words;
      wi = at;
      ci = 0;
      refillMiss = 0;
      return true;
    }
    refillMiss++;
    note("refill-wait:fresh-missing w" + (wi + 1) + " miss#" + refillMiss);
    if (refillMiss >= 5 && r.words.length >= 10 && !samePage(r.words, words)) {
      let overlap = 0;
      for (let k = 0; k < 5 && (wi + k) < words.length; k++) {
        if (r.words.indexOf(words[wi + k]) >= 0) overlap++;
      }
      if (overlap === 0) {
        note("page-turn adopt n=" + r.words.length + " abs=" + absDone);
        words = r.words;
        wi = 0;
        ci = 0;
        boxExp = "";
        needClear = true;
        refillMiss = 0;
        return true;
      }
      note("page-turn blocked overlap=" + overlap);
    }
    return false;
  }

  async function step() {
    if (!typing) return;
    try {
      let input = getInput();
      if (!input) {
        // DOM churn (React swap): wait up to 5s for the box to come back.
        for (let w = 0; w < 20 && typing; w++) {
          if (!(await sleepWhile(250))) return;
          input = getInput();
          if (input) break;
        }
        if (!input) { fail("No textarea"); release(); return; }
        note("input-recovered");
      }
      if (needClear) { await trustedClear(input); needClear = false; boxExp = ""; }
      // Re-parse at most once per word (ci==0): mid-word re-parses race the
      // scroll and adopt the wrong page while a keystroke is in flight.
      if (ci === 0 && (wi > 0 || absDone > 0)) refill();
      if (wi >= words.length) {
        // Row-exhaustion: fresh rows render late; poll via refill() which now
        // extends only on same-page evidence. Unconditional mid-poll adopt is
        // removed: a wobbling re-parse must never swap the list we just typed.
        let fresh = false;
        for (let p = 0; p < 40 && typing; p++) {
          refill();
          if (wi < words.length) { fresh = true; lastSubmitAt = Date.now(); break; }
          if (p === 20) {
            try {
              const b = getBox();
              if (b) await trustedClick(b, "rows-refocus");
              await awaitFocus(input, "rows");
            } catch (e) {}
          }
          if (p % 10 === 0) note("wait-rows p" + p);
          if (!(await sleepWhile(250))) return;
        }
        if (!fresh) {
          note("wait-rows:holding abs=" + (absDone + 1));
          paint();
          timer = setTimeout(async () => {
            if (!(await gated(scheduleFloor()))) return;
            step();
          }, 0);
          return;
        }
      }
      const word = words[wi];
      const key = ci < word.length ? word[ci] : " ";
      lastKey = key;
      note("key:" + key + " w" + (wi + 1) + "/" + words.length);
      if (!(await pressChar(input, key))) {
        if (!typing) return;
        note("press-retry w" + (wi + 1) + " key=" + key);
        if (!(await sleepWhile(150))) return;
        if (!(await pressChar(input, key))) { fail(blockMsg()); release(); return; }
        note("press-recovered w" + (wi + 1));
      }
      ticks++;
      typedChars++;
      lastTickAt = Date.now();
      if (ci < word.length) ci++;
      else {
        // Commit-verified submit: page must ACK by clearing the box.
        // Transient stuck = refocus + resync + retry SAME word (never skip:
        // a skip on a wrong-list word shifts every later word by one, so the
        // whole run goes red from ~w10 on). Only Stop ends the run.
        const done = await waitSubmit(input);
        if (!done.ok) {
          if (done.stopped || !typing) return;
          stuck++;
          note("submit-stuck w" + (wi + 1) + " exp=" + JSON.stringify(boxExp) + " val=" + JSON.stringify(input.value) + " stuck#" + stuck);
          await awaitFocus(input, "stuck");
          await resync(input, word);
          ci = 0;
          paint();
          timer = setTimeout(async () => {
            if (!(await gated(scheduleFloor()))) return;
            step();
          }, 0);
          if (!typing) return;
          return;
        } else { winClean = false; }
        if (stuck > 0) note("submit-clean w" + (wi + 1) + " after-stuck#" + stuck);
        stuck = 0;
        lastSubmitAt = Date.now();
        boxExp = "";
        ci = 0;
        wi++;
        absDone++;
        if (input.value === words[wi - 1]) {
          note("clear-echo w" + wi + " retry-same");
          wi--;
          absDone--;
        } else {
          note("clear word w" + wi + "/" + words.length + " val=" + input.value.length);
        }
      }
      paint();
      timer = setTimeout(async () => {
        if (!(await gated(scheduleFloor()))) return;
        step();
      }, 0);
    } catch (e) {
      fail("Err:" + String((e && e.message) || e).slice(0, 40));
      release();
    }
  }

  function paint() {
    if (!btn) return;
    btn.dataset.version = V;
    btn.dataset.state = typing ? "typing" : (lastError ? "error" : "idle");
    btn.dataset.error = lastError || "";
    const live = typeStart ? Math.round(typedChars / 5 / ((Date.now() - typeStart) / 60000) || 0) : 0;
    const abs = absDone + 1;
    btn.title = "10FF v" + V + " " + mode + (typing ? " w" + abs + "/" + GOAL + " " + live + "wpm" : (lastError ? " " + lastError : " idle"));
    if (typing) {
      setLabel("\u25A0 " + abs + "/" + GOAL + " " + live + "wpm");
      btn.style.background = "#c0392b";
    } else if (lastError) {
      setLabel(lastError);
      btn.style.background = "#e67e22";
    } else {
      setLabel("\u25B6 Type");
      btn.style.background = "#27ae60";
    }
  }

  function release() {
    sendBg({ type: "DBG_RELEASE" });
  }

  function fail(msg) {
    clearTimeout(timer);
    timer = null;
    typing = false;
    lastError = msg;
    paint();
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
    typing = false;
    paint();
    release();
  }

  async function start() {
    if (typing || busy) return;
    busy = true;
    try {
      // Stale attach verdicts never survive into a new run.
      dbgOk = null;
      dbgErr = "";
      mode = "exec";
      lastError = "";
      paint();
      const box = getBox();
      const input = getInput();
      if (!box) { fail("No word-box"); return; }
      if (!input) { fail("No textarea"); return; }
      const r = getWords();
      if (!r.words.length) { fail(r.why); return; }
      const banner = document.querySelector('[data-testid="InactiveBanner"]');
      if (banner && banner.parentElement) {
        await trustedClick(banner.parentElement, "banner");
        if (!(await sleepWhile(150))) return;
      }
      await trustedClick(box, "box");
      if (!(await sleepWhile(150))) return;
      input.focus();
      if (!(await awaitFocus(input, "pre"))) { fail("Click ignored"); return; }
      if (!(await trustedClear(input))) { fail("Textarea locked"); return; }
      if (!(await awaitFocus(input, "post"))) { fail("Focus lost"); return; }
      words = r.words;
      wi = 0;
      ci = 0;
      boxExp = "";
      stuck = 0;
      ticks = 0;
      retries = 0;
      typedChars = 0;
      absDone = 0;
      needClear = false;
      refillMiss = 0;
      typeStart = Date.now();
      lastSubmitAt = Date.now();
      nextDue = 0;
      typing = true;
      paint();
      step();
    } finally {
      busy = false;
    }
  }

  // Host stays silent, label lives in a child node so page re-renders never wipe it.
  function injectBtn() {
    let host = document.getElementById("__ff10btn");
    if (host) { btn = host; }
    else {
      host = document.createElement("button");
      host.type = "button";
      host.id = "__ff10btn";
      host.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:999999;padding:10px 16px;border:none;border-radius:8px;background:#27ae60;color:#fff;font:bold 14px sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)";
      host.onclick = () => (typing ? stop() : start());
      (document.body || document.documentElement).appendChild(host);
    }
    if (!host.firstChild) host.appendChild(document.createTextNode(""));
    btn = host;
    paint();
  }

  function setLabel(text) {
    if (btn && btn.firstChild) btn.firstChild.nodeValue = text;
    else if (btn) btn.textContent = text;
  }

  window.__ff10 = {
    v: V,
    start, stop,
    refillNow: () => { const before = { wi, ci, total: words.length }; refill(); return { before, wi, ci, total: words.length, absDone }; },
    state: () => ({ typing, wpm, wi, ci, ticks, retries, total: words.length, goal: GOAL, absDone, error: lastError, mode, lastKey,
      actualWpm: typeStart ? Math.round(typedChars / 5 / ((Date.now() - typeStart) / 60000) || 0) : 0 }),
    diag: () => ({
      v: V,
      mode,
      dbg: dbgOk,
      dbgErr: dbgErr || undefined,
      box: !!getBox(),
      spans: (getBox() && getBox().querySelectorAll("span").length) || 0,
      input: !!getInput(),
      valueLen: (getInput() && getInput().value.length) ?? -1,
      focused: (() => { try { return document.activeElement === getInput(); } catch (e) { return "n/a"; } })(),
      banner: !!document.querySelector('[data-testid="InactiveBanner"]'),
      ticks,
      presses,
      retries,
      clicks,
      clears,
      lastKey,
      boxExp,
      stuck,
      absDone,
      refillMiss,
      tickAgoMs: lastTickAt ? Date.now() - lastTickAt : -1,
      submitAgoMs: lastSubmitAt ? Date.now() - lastSubmitAt : -1,
      trace: trace.slice(-12),
      btn: document.getElementById("__ff10btn")?.dataset
    }),
    probe: () => {
      try {
        const t = document.createElement("textarea");
        t.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(t);
        t.focus();
        const ok = document.execCommand("insertText", false, "z");
        const out = { ok: !!ok, inserted: t.value === "z" };
        t.remove();
        try { getInput()?.focus(); } catch (e) {}
        return out;
      } catch (e) { return { err: String(e).slice(0, 80) }; }
    },
    // Fresh attach verdict every call, leaves nothing attached behind.
    probeDbg: async () => {
      dbgOk = null;
      dbgErr = "";
      const r = await sendBg({ type: "DBG_ENSURE" });
      await sendBg({ type: "DBG_RELEASE" });
      return r;
    }
  };

  // One observer at a time, old revisions disconnect first (see top of file).
  window.__ff10obs = new MutationObserver(() => {
    const b = document.getElementById("__ff10btn");
    if (!b) { btn = null; injectBtn(); }
    else if (b.dataset.version !== V) { b.remove(); btn = null; injectBtn(); }
  });
  window.__ff10obs.observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    (async () => {
      if (msg.type === "START") { wpm = clampWpm(msg.wpm ?? wpm); await start(); }
      else if (msg.type === "STOP") stop();
      else if (msg.type === "TOGGLE") { if (typing) stop(); else await start(); }
      else if (msg.type === "SET_WPM") { wpm = clampWpm(msg.wpm); chrome.storage.local.set({ wpm }); }
      const liveWpm = typeStart ? Math.round(typedChars / 5 / ((Date.now() - typeStart) / 60000) || 0) : 0;
      reply({ typing, wpm, error: lastError, v: V, mode, actualWpm: liveWpm, wi, total: words.length, goal: GOAL, absDone });
    })();
    return true;
  });

  injectBtn();
  console.log("[10FF] content v" + V + " loaded");
  // Autoplay once per page load: start typing as soon as the word box is ready.
  setTimeout(async () => {
    try {
      if (typing || busy || lastError) return;
      if (!getBox() || !getInput()) return;
      note("autostart");
      await start();
    } catch (e) { note("autostart-err"); }
  }, 1500);
  // Keepalive: no submitted word for 45s while typing with no error means the
  // loop wedged between ticks. Re-drive one step from the live cursor.
  setInterval(() => {
    try {
      if (!typing || busy || lastError) return;
      if (!typeStart) return;
      if (Date.now() - lastSubmitAt < 45000) return;
      if (Date.now() - typeStart < 45000) return;
      note("keepalive-restart w" + (wi + 1));
      clearTimeout(timer);
      timer = null;
      step();
    } catch (e) {}
  }, 5000);
})();
