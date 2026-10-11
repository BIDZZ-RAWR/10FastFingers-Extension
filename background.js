const attached = new Set();

function tabIdOf(sender) {
  return sender?.tab?.id;
}

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd !== "toggle-typing") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url?.includes("10fastfingers.com")) return;
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE" }).catch(() => {});
  });
});

function sendOk(send, extra) {
  try { send(Object.assign({ ok: true }, extra)); } catch (e) {}
}

function sendFail(send, error) {
  try { send({ ok: false, error: String(error).slice(0, 120) }); } catch (e) {}
}

async function detach(tabId) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch (e) {}
}

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  (async () => {
    if (msg.type === "DBG_ENSURE") {
      const tabId = tabIdOf(sender);
      if (!tabId) { sendFail(send, "no-tab"); return; }
      if (!attached.has(tabId)) {
        try {
          await chrome.debugger.attach({ tabId }, "1.3");
          attached.add(tabId);
        } catch (e) {
          const m = String(e.message || e);
          if (/already attached/i.test(m)) {
            try { await chrome.debugger.detach({ tabId }); } catch (_) {}
            try {
              await chrome.debugger.attach({ tabId }, "1.3");
              attached.add(tabId);
            } catch (e2) { sendFail(send, e2.message || e2); return; }
          } else { sendFail(send, e.message || e); return; }
        }
      }
      sendOk(send, {});
      return;
    }
    if (msg.type === "DBG_KEY") {
      const tabId = tabIdOf(sender);
      if (!tabId || !attached.has(tabId)) { sendFail(send, "not-attached"); return; }
      const key = msg.key;
      const code = msg.code || (key === " " ? "Space" : key === "Backspace" ? "Backspace" : "");
      const vk = msg.vk || (key === "Backspace" ? 8 : key === " " ? 32 : 0);
      try {
        // Trusted keyDown/keyUp drive the site timer, insertText fills the box.
        if (key === "Backspace") {
          await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
            type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8
          });
          await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
            type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8
          });
        } else {
          // keyDown carries NO text (text would insert a second char before insertText).
          await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
            type: "keyDown", key, code, windowsVirtualKeyCode: vk
          });
          await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text: key });
          await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
            type: "keyUp", key, code, windowsVirtualKeyCode: vk
          });
        }
        sendOk(send, {});
      } catch (e) { sendFail(send, e.message || e); }
      return;
    }
    if (msg.type === "DBG_CLICK") {
      const tabId = tabIdOf(sender);
      if (!tabId || !attached.has(tabId)) { sendFail(send, "not-attached"); return; }
      try {
        const x = Math.round(Number(msg.x) || 0);
        const y = Math.round(Number(msg.y) || 0);
        for (const t of ["mousePressed", "mouseReleased"]) {
          await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
            type: t, x, y, button: "left", clickCount: 1
          });
        }
        sendOk(send, {});
      } catch (e) { sendFail(send, e.message || e); }
      return;
    }
    if (msg.type === "DBG_RELEASE") {
      const tabId = tabIdOf(sender);
      if (tabId) await detach(tabId);
      sendOk(send, {});
      return;
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => { attached.delete(tabId); });
chrome.debugger.onDetach.addListener((source) => {
  if (source?.tabId) attached.delete(source.tabId);
});
