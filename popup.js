const s = document.getElementById("s"), b = document.getElementById("b"), v = document.getElementById("v");
let typing = false;

function send(msg, optimistic) {
  if (optimistic) paint(optimistic);
  chrome.tabs.query({ active: true, currentWindow: true }, (t) => {
    if (!t[0]?.id) { v.textContent = "Buka tab 10fastfingers dulu"; if (optimistic) send({ type: "GET_STATE" }); return; }
    chrome.tabs.sendMessage(t[0].id, msg, (state) => {
      if (chrome.runtime.lastError || !state) {
        v.textContent = "Reload halaman lalu coba lagi";
        if (optimistic) { typing = false; paint({ typing: false, wpm: +s.value, error: "" }); }
        return;
      }
      sync(state);
    });
  });
}
function paint(st) {
  typing = st.typing;
  s.value = st.wpm;
  v.textContent = st.error ? st.error : (st.typing ? ("w" + (((st.absDone ?? st.wi) || 0) + 1) + "/" + (st.goal || st.total) + " ") : "") + st.wpm + " WPM" + (st.actualWpm ? " (" + st.actualWpm + ")" : "");
  b.textContent = typing ? "Stop (Alt+T)" : "Start (Alt+T)";
  b.className = typing ? "stop" : "";
}
function sync(state) {
  if (!state) return;
  paint(state);
}
s.oninput = () => { v.textContent = s.value + " WPM"; send({ type: "SET_WPM", wpm: +s.value }); };
b.onclick = () => send(
  { type: typing ? "STOP" : "START", wpm: +s.value },
  { typing: !typing, wpm: +s.value, error: "" }
);
send({ type: "GET_STATE" });
