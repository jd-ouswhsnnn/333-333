const MODULE_ID = "3";
const SOCKET_NAME = "module.3";

const RED_CLASS = "three-red";
const BLUE_CLASS = "three-blue";
const RED_VAR = "--three-red";
const BLUE_VAR = "--three-blue";

const DEFAULTS = {
  patternRed: "3|٣|३|๓|３|③|⑶|³|₃|Ⅲ|ⅲ|三|叁|参|弎|仨|𐒣|𒐈|௩|౩|೩|൩|᥉|꧓|᠓|𑁩|𝟑|𝟛|𝟥|𝟹|▲|▼|△|▽|机构|[Tt][Hh][Rr][Ee][Ee]",
  colorRed: "#c91f2f",
  patternBlue: "异常体|异常",
  colorBlue: "#1e6fe0"
};

const SHARED_KEYS = ["patternRed", "colorRed", "patternBlue", "colorBlue"];

const ROLES = (typeof CONST !== "undefined" && CONST.USER_ROLES) || {
  NONE: 0, PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4
};

const ONLY_TRIANGLES = /^[▲▼△▽\s]+$/;

const TRIANGLE_SKIP_SELECTORS = [
  ".qa-pip",
  ".track-line",
  ".track-box",
  ".track-action",
  ".track-milestone",
  ".tabbed li > span",
  ".sidenav li > span",
  ".window-header"
].join(",");

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED",
  "INPUT", "TEXTAREA", "SELECT", "OPTION", "OPTGROUP",
  "CODE", "PRE", "KBD", "SAMP", "VAR", "TT",
  "TITLE", "META", "LINK", "HEAD"
]);

const OBSERVER_OPTIONS = {
  childList: true,
  subtree: true,
  characterData: true
};

const GROUPS = [
  {
    name: "red",
    className: RED_CLASS,
    colorVar: RED_VAR,
    patternKey: "patternRed",
    colorKey: "colorRed",
    defaultColor: DEFAULTS.colorRed,
    notifyKey: "THREE.Notification.RedPatternChanged"
  },
  {
    name: "blue",
    className: BLUE_CLASS,
    colorVar: BLUE_VAR,
    patternKey: "patternBlue",
    colorKey: "colorBlue",
    defaultColor: DEFAULTS.colorBlue,
    notifyKey: "THREE.Notification.BluePatternChanged"
  }
];

function compileGroup(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0) return null;
  try {
    const testRe = new RegExp(pattern);
    if (testRe.test("")) return null;
    return { testRe, globalRe: new RegExp(pattern, "g") };
  } catch (err) {
    return null;
  }
}

function isValidColor(value) {
  const v = String(value ?? "").trim();
  if (!v) return false;
  try {
    if (typeof CSS !== "undefined" && CSS.supports) return CSS.supports("color", v);
  } catch (err) {}
  return true;
}

function validateSetting(key, value) {
  if (key === "patternRed" || key === "patternBlue") {
    if (!compileGroup(value)) return "THREE.Notification.InvalidPattern";
  } else if (key === "colorRed" || key === "colorBlue") {
    if (!isValidColor(value)) return "THREE.Notification.InvalidColor";
  }
  return null;
}

let observer = null;
let enabled = true;

const compiled = {
  red: compileGroup(DEFAULTS.patternRed),
  blue: compileGroup(DEFAULTS.patternBlue)
};

const lastValid = {
  patternRed: DEFAULTS.patternRed,
  colorRed: DEFAULTS.colorRed,
  patternBlue: DEFAULTS.patternBlue,
  colorBlue: DEFAULTS.colorBlue
};

let applyingRemote = false;
let expectingState = false;

function isSkipped(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el.closest?.(`.${RED_CLASS}, .${BLUE_CLASS}`)) return true;
  return false;
}

function makeSpan(text, groupName) {
  const span = document.createElement("span");
  span.className = groupName === "blue" ? BLUE_CLASS : RED_CLASS;
  span.textContent = text;
  return span;
}

function collectMatches(text) {
  const found = [];
  for (const group of GROUPS) {
    const pair = compiled[group.name];
    if (!pair) continue;
    pair.globalRe.lastIndex = 0;
    let m;
    while ((m = pair.globalRe.exec(text)) !== null) {
      if (m[0].length === 0) {
        pair.globalRe.lastIndex++;
        continue;
      }
      found.push({ index: m.index, length: m[0].length, text: m[0], group: group.name });
    }
  }
  found.sort((a, b) => a.index - b.index || b.length - a.length);
  const accepted = [];
  let end = 0;
  for (const m of found) {
    if (m.index >= end) {
      accepted.push(m);
      end = m.index + m.length;
    }
  }
  return accepted;
}

function buildFragment(text) {
  const frag = document.createDocumentFragment();
  const matches = collectMatches(text);
  let lastIndex = 0;
  for (const m of matches) {
    if (m.index > lastIndex) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
    }
    frag.appendChild(makeSpan(m.text, m.group));
    lastIndex = m.index + m.length;
  }
  if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  return frag;
}

function processTextNode(node) {
  if (!enabled) return;
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  if (!node.parentNode) return;

  const text = node.nodeValue;
  if (!text) return;
  const red = compiled.red;
  const blue = compiled.blue;
  const hit = (red && red.testRe.test(text)) || (blue && blue.testRe.test(text));
  if (!hit) return;

  const parent = node.parentElement;
  if (isSkipped(parent)) return;

  if (ONLY_TRIANGLES.test(text) && parent.closest(TRIANGLE_SKIP_SELECTORS)) return;

  const frag = buildFragment(text);
  try {
    parent.replaceChild(frag, node);
  } catch (err) {
    console.warn(`[${MODULE_ID}] replaceChild failed:`, err);
  }
}

function walkElement(root) {
  if (!enabled || !root) return;

  if (root.nodeType === Node.TEXT_NODE) {
    processTextNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  if (isSkipped(root)) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
      const red = compiled.red;
      const blue = compiled.blue;
      const hit = (red && red.testRe.test(n.nodeValue)) || (blue && blue.testRe.test(n.nodeValue));
      if (!hit) return NodeFilter.FILTER_REJECT;
      if (isSkipped(n.parentElement)) return NodeFilter.FILTER_REJECT;
      if (ONLY_TRIANGLES.test(n.nodeValue) && n.parentElement?.closest(TRIANGLE_SKIP_SELECTORS)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  let cur;
  while ((cur = walker.nextNode())) nodes.push(cur);
  for (const n of nodes) processTextNode(n);
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    if (!enabled) return;
    for (const m of mutations) {
      if (m.type === "characterData") {
        processTextNode(m.target);
      } else if (m.type === "childList") {
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.TEXT_NODE) processTextNode(n);
          else if (n.nodeType === Node.ELEMENT_NODE) walkElement(n);
        }
      }
    }
  });
  observer.observe(document.body, OBSERVER_OPTIONS);
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

function unwrapAll() {
  if (!document.body) return;
  document.querySelectorAll(`.${RED_CLASS}, .${BLUE_CLASS}`).forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(span.textContent ?? ""), span);
    parent.normalize();
  });
}

function applyColor(group, value) {
  const v = String(value ?? "").trim() || group.defaultColor;
  document.documentElement.style.setProperty(group.colorVar, v);
}

function setEnabled(value, notify) {
  const next = !!value;
  const changed = next !== enabled;
  enabled = next;
  if (enabled) {
    for (const group of GROUPS) applyColor(group, game.settings.get(MODULE_ID, group.colorKey));
    walkElement(document.body);
    startObserver();
  } else {
    stopObserver();
    unwrapAll();
  }
  if (notify && changed) {
    ui.notifications.info(
      game.i18n.localize(enabled ? "THREE.Notification.Enabled" : "THREE.Notification.Disabled")
    );
  }
}

function refreshText() {
  if (!enabled) return;
  unwrapAll();
  walkElement(document.body);
}

function syncGroup(group, patternValue, colorValue) {
  const pair = compileGroup(patternValue);
  if (pair) {
    compiled[group.name] = pair;
    lastValid[group.patternKey] = patternValue;
  } else {
    compiled[group.name] = compileGroup(DEFAULTS[group.patternKey]);
    lastValid[group.patternKey] = DEFAULTS[group.patternKey];
  }
  const color = isValidColor(colorValue) ? colorValue : group.defaultColor;
  lastValid[group.colorKey] = color;
  applyColor(group, color);
}

function syncFromSettings() {
  const wantEnabled = game.settings.get(MODULE_ID, "enabled");
  for (const group of GROUPS) {
    syncGroup(
      group,
      game.settings.get(MODULE_ID, group.patternKey),
      game.settings.get(MODULE_ID, group.colorKey)
    );
  }
  if (wantEnabled !== enabled) setEnabled(wantEnabled, false);
  refreshText();
}

function currentSharedConfig() {
  const cfg = {};
  for (const key of SHARED_KEYS) cfg[key] = game.settings.get(MODULE_ID, key);
  return cfg;
}

function isDefaultConfig() {
  return SHARED_KEYS.every((key) => game.settings.get(MODULE_ID, key) === DEFAULTS[key]);
}

function broadcastUpdate() {
  game.socket?.emit?.(SOCKET_NAME, {
    type: "update",
    senderId: game.user?.id,
    settings: currentSharedConfig()
  });
}

function requestState() {
  expectingState = true;
  game.socket?.emit?.(SOCKET_NAME, { type: "request", senderId: game.user?.id });
  setTimeout(() => { expectingState = false; }, 3000);
}

async function applyRemoteSettings(settings) {
  if (!settings || typeof settings !== "object") return;
  applyingRemote = true;
  try {
    for (const key of SHARED_KEYS) {
      const value = settings[key];
      if (value === undefined || value === null) continue;
      if (value === game.settings.get(MODULE_ID, key)) continue;
      if (validateSetting(key, value)) continue;
      await game.settings.set(MODULE_ID, key, value);
    }
  } finally {
    applyingRemote = false;
  }
  syncFromSettings();
}

async function adoptSnapshot() {
  let snap;
  try {
    snap = JSON.parse(game.settings.get(MODULE_ID, "snapshot") || "");
  } catch (err) { return; }
  if (!snap || typeof snap !== "object") return;
  if (!isDefaultConfig()) return;

  applyingRemote = true;
  try {
    for (const key of SHARED_KEYS) {
      const value = snap[key];
      if (value === undefined || value === null) continue;
      if (value === DEFAULTS[key]) continue;
      if (validateSetting(key, value)) continue;
      await game.settings.set(MODULE_ID, key, value);
    }
  } finally {
    applyingRemote = false;
  }
  syncFromSettings();
}

function saveSnapshot() {
  if ((game.user?.role ?? 0) < ROLES.ASSISTANT) return;
  const snap = JSON.stringify(currentSharedConfig());
  if (snap === game.settings.get(MODULE_ID, "snapshot")) return;
  try {
    Promise.resolve(game.settings.set(MODULE_ID, "snapshot", snap)).catch(() => {});
  } catch (err) {}
}

function onSocketMessage(payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.senderId != null && payload.senderId === game.user?.id) return;

  if (payload.type === "update") {
    applyRemoteSettings(payload.settings);
  } else if (payload.type === "request") {
    if (!isDefaultConfig()) {
      game.socket?.emit?.(SOCKET_NAME, {
        type: "state",
        senderId: game.user?.id,
        settings: currentSharedConfig()
      });
    }
  } else if (payload.type === "state") {
    if (expectingState) {
      expectingState = false;
      applyRemoteSettings(payload.settings);
    }
  }
}

function wrapSettingsSet() {
  const coreSet = game.settings.set.bind(game.settings);
  game.settings.set = async function (namespace, key, value, options) {
    if (namespace === MODULE_ID && !applyingRemote) {
      const error = validateSetting(key, value);
      if (error) {
        ui.notifications.error(game.i18n.localize(error));
        return;
      }
    }
    const result = await coreSet(namespace, key, value, options);
    if (namespace === MODULE_ID && !applyingRemote && SHARED_KEYS.includes(key)) {
      broadcastUpdate();
      saveSnapshot();
    }
    return result;
  };
}

function makePatternChangeHandler(groupName) {
  const group = GROUPS.find((g) => g.name === groupName);
  return (value) => {
    const pair = compileGroup(value);
    if (!pair) {
      ui.notifications.error(game.i18n.localize("THREE.Notification.InvalidPattern"));
      game.settings.set(MODULE_ID, group.patternKey, lastValid[group.patternKey]);
      return;
    }
    compiled[groupName] = pair;
    lastValid[group.patternKey] = value;
    refreshText();
    if (!applyingRemote) {
      const shown = value.length > 40 ? `${value.slice(0, 40)}…` : value;
      ui.notifications.info(game.i18n.format(group.notifyKey, { pattern: shown }));
    }
  };
}

function makeColorChangeHandler(groupName) {
  const group = GROUPS.find((g) => g.name === groupName);
  return (value) => {
    if (!isValidColor(value)) {
      ui.notifications.error(game.i18n.localize("THREE.Notification.InvalidColor"));
      game.settings.set(MODULE_ID, group.colorKey, lastValid[group.colorKey]);
      return;
    }
    lastValid[group.colorKey] = value;
    applyColor(group, value);
  };
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enabled", {
    name: "THREE.Settings.Enabled.Name",
    hint: "THREE.Settings.Enabled.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: (value) => setEnabled(value, true)
  });

  game.settings.register(MODULE_ID, "patternRed", {
    name: "THREE.Settings.PatternRed.Name",
    hint: "THREE.Settings.PatternRed.Hint",
    scope: "client",
    config: true,
    type: String,
    default: DEFAULTS.patternRed,
    onChange: makePatternChangeHandler("red")
  });

  game.settings.register(MODULE_ID, "colorRed", {
    name: "THREE.Settings.ColorRed.Name",
    hint: "THREE.Settings.ColorRed.Hint",
    scope: "client",
    config: true,
    type: String,
    default: DEFAULTS.colorRed,
    onChange: makeColorChangeHandler("red")
  });

  game.settings.register(MODULE_ID, "patternBlue", {
    name: "THREE.Settings.PatternBlue.Name",
    hint: "THREE.Settings.PatternBlue.Hint",
    scope: "client",
    config: true,
    type: String,
    default: DEFAULTS.patternBlue,
    onChange: makePatternChangeHandler("blue")
  });

  game.settings.register(MODULE_ID, "colorBlue", {
    name: "THREE.Settings.ColorBlue.Name",
    hint: "THREE.Settings.ColorBlue.Hint",
    scope: "client",
    config: true,
    type: String,
    default: DEFAULTS.colorBlue,
    onChange: makeColorChangeHandler("blue")
  });

  game.settings.register(MODULE_ID, "snapshot", {
    name: "THREE.Settings.Snapshot.Name",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  wrapSettingsSet();
});

Hooks.once("ready", async () => {
  enabled = game.settings.get(MODULE_ID, "enabled");

  for (const group of GROUPS) {
    const storedPattern = game.settings.get(MODULE_ID, group.patternKey);
    const pair = compileGroup(storedPattern);
    if (pair) {
      compiled[group.name] = pair;
      lastValid[group.patternKey] = storedPattern;
    } else {
      compiled[group.name] = compileGroup(DEFAULTS[group.patternKey]);
      lastValid[group.patternKey] = DEFAULTS[group.patternKey];
      ui.notifications.warn(game.i18n.localize("THREE.Notification.InvalidPatternFallback"));
    }
    const storedColor = game.settings.get(MODULE_ID, group.colorKey);
    if (isValidColor(storedColor)) {
      lastValid[group.colorKey] = storedColor;
      applyColor(group, storedColor);
    } else {
      lastValid[group.colorKey] = group.defaultColor;
      applyColor(group, group.defaultColor);
    }
  }

  await adoptSnapshot();

  game.socket.on(SOCKET_NAME, onSocketMessage);
  requestState();

  globalThis.Three = {
    rescan() {
      walkElement(document.body);
      ui.notifications.info(game.i18n.localize("THREE.Notification.Rescan"));
    },
    enable() {
      enabled = true;
      for (const group of GROUPS) applyColor(group, game.settings.get(MODULE_ID, group.colorKey));
      walkElement(document.body);
      startObserver();
    },
    disable() {
      enabled = false;
      stopObserver();
      unwrapAll();
    },
    get enabled() {
      return enabled;
    },
    get patterns() {
      return {
        red: game.settings.get(MODULE_ID, "patternRed"),
        blue: game.settings.get(MODULE_ID, "patternBlue")
      };
    }
  };

  if (!enabled) return;

  walkElement(document.body);
  startObserver();

  setTimeout(() => {
    if (enabled) walkElement(document.body);
  }, 500);
});

Hooks.on("renderSettingsConfig", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const fields = [...root.querySelectorAll("input, textarea")];
  const enabledInput = fields.find(
    (el) => el.name === "enabled" || el.name === `${MODULE_ID}.enabled`
  );
  if (enabledInput) {
    enabledInput.addEventListener("change", () => setEnabled(enabledInput.checked, true));
  }
  for (const group of GROUPS) {
    const patternInput = fields.find(
      (el) => el.name === group.patternKey || el.name === `${MODULE_ID}.${group.patternKey}`
    );
    if (patternInput) {
      let timer = null;
      patternInput.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const pair = compileGroup(patternInput.value);
          if (!pair) return;
          compiled[group.name] = pair;
          lastValid[group.patternKey] = patternInput.value;
          refreshText();
        }, 200);
      });
      patternInput.addEventListener("change", () => {
        const value = patternInput.value;
        if (value === game.settings.get(MODULE_ID, group.patternKey)) return;
        game.settings.set(MODULE_ID, group.patternKey, value).catch(() => {});
      });
    }
    const colorInput = fields.find(
      (el) => el.name === group.colorKey || el.name === `${MODULE_ID}.${group.colorKey}`
    );
    if (colorInput) {
      colorInput.addEventListener("input", () => {
        if (!isValidColor(colorInput.value)) return;
        lastValid[group.colorKey] = colorInput.value;
        applyColor(group, colorInput.value);
      });
      colorInput.addEventListener("change", () => {
        const value = colorInput.value;
        if (value === game.settings.get(MODULE_ID, group.colorKey)) return;
        game.settings.set(MODULE_ID, group.colorKey, value).catch(() => {});
      });
    }
  }
});

Hooks.on("renderApplicationV2", (_app, element) => {
  if (!enabled) return;
  const el = element instanceof HTMLElement ? element : element?.[0];
  if (el) walkElement(el);
});

Hooks.on("renderApplication", (_app, html) => {
  if (!enabled) return;
  const el = html instanceof HTMLElement ? html : html?.[0];
  if (el) walkElement(el);
});

Hooks.on("renderChatMessageHTML", (_message, element) => {
  if (!enabled) return;
  const el = element instanceof HTMLElement ? element : element?.[0];
  if (el) walkElement(el);
});

Hooks.on("renderChatMessage", (_message, html) => {
  if (!enabled) return;
  const el = html instanceof HTMLElement ? html : html?.[0];
  if (el) walkElement(el);
});

Hooks.on("canvasReady", () => {
  if (!enabled) return;
  walkElement(document.body);
});

Hooks.on("updateSetting", (setting) => {
  if (setting?.namespace === MODULE_ID) {
    syncFromSettings();
    return;
  }
  if (!enabled) return;
  walkElement(document.body);
});

Hooks.on("userConnected", () => {
  if (!enabled) return;
  walkElement(document.body);
});

Hooks.on("renderSceneControls", () => {
  if (!enabled) return;
  walkElement(document.body);
});

window.addEventListener("resize", () => {
  if (enabled) walkElement(document.body);
});
