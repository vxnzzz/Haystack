const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const showLoginBtn = document.getElementById("showLoginBtn");
const showSignupBtn = document.getElementById("showSignupBtn");
const authForm = document.getElementById("authForm");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const usernameInput = document.getElementById("usernameInput");
const passwordInput = document.getElementById("passwordInput");
const authStatus = document.getElementById("authStatus");
const guestBtn = document.getElementById("guestBtn");
const meLabel = document.getElementById("meLabel");
const logoutBtn = document.getElementById("logoutBtn");
const tabs = Array.from(document.querySelectorAll(".tab"));
const panels = {
  chattar: document.getElementById("tab-chattar"),
  vanner: document.getElementById("tab-vanner"),
  forfragningar: document.getElementById("tab-forfragningar"),
  global: document.getElementById("tab-global"),
  profil: document.getElementById("tab-profil"),
  installningar: document.getElementById("tab-installningar"),
};
const friendsList = document.getElementById("friendsList");
const chatTitle = document.getElementById("chatTitle");
const messagesList = document.getElementById("messagesList");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const fileInput = document.getElementById("fileInput");
const addFriendForm = document.getElementById("addFriendForm");
const addFriendInput = document.getElementById("addFriendInput");
const friendStatus = document.getElementById("friendStatus");
const requestsList = document.getElementById("requestsList");
const profileName = document.getElementById("profileName");
const avatarPreview = document.getElementById("avatarPreview");
const avatarForm = document.getElementById("avatarForm");
const avatarInput = document.getElementById("avatarInput");
const profileStatus = document.getElementById("profileStatus");
const globalMessagesList = document.getElementById("globalMessagesList");
const globalMessageForm = document.getElementById("globalMessageForm");
const globalMessageInput = document.getElementById("globalMessageInput");
const globalFileInput = document.getElementById("globalFileInput");
const darkModeToggle = document.getElementById("darkModeToggle");
const highContrastToggle = document.getElementById("highContrastToggle");
const fontScaleSelect = document.getElementById("fontScaleSelect");
const reducedMotionToggle = document.getElementById("reducedMotionToggle");

const TOKEN_KEY = "haystack_token";
const SETTINGS_KEY = "haystack_settings";
const PRIVATE_KEY_PREFIX = "haystack_private_key_";
let authMode = "login";
let me = null;
let activeFriend = null;
let guestPollHandle = null;
let dmPollHandle = null;

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Serverfel");
  }
  return data;
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  showLoginBtn.classList.toggle("active", isLogin);
  showSignupBtn.classList.toggle("active", !isLogin);
  authSubmitBtn.textContent = isLogin ? "Logga in" : "Skapa konto";
  authStatus.textContent = "";
}

function switchToApp() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
}

function switchToAuth() {
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
  stopPolling();
}

function setActiveTab(tabId) {
  for (const tab of tabs) {
    tab.classList.toggle("active", tab.dataset.tab === tabId);
  }
  for (const [key, panel] of Object.entries(panels)) {
    panel.classList.toggle("hidden", key !== tabId);
  }
}

async function refreshMe() {
  const data = await api("/api/me");
  me = data.user;
  meLabel.textContent = `Inloggad som ${me.username}`;
  profileName.textContent = `Anvandarnamn: ${me.username}`;
  avatarPreview.src = me.avatar_url || "";
  avatarInput.value = me.avatar_url || "";
  if (me.is_guest) {
    setActiveTab("global");
  }
}

function createButton(text, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

async function refreshFriends() {
  const data = await api("/api/friends");
  friendsList.innerHTML = "";
  if (data.friends.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Inga vanner an.";
    friendsList.appendChild(empty);
    return;
  }

  for (const friend of data.friends) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "list-item";
    if (activeFriend === friend.username) row.classList.add("active");
    row.textContent = friend.username;
    row.addEventListener("click", () => {
      activeFriend = friend.username;
      chatTitle.textContent = `Chat med ${friend.username}`;
      refreshFriends();
      refreshMessages();
    });
    friendsList.appendChild(row);
  }
}

async function refreshMessages() {
  messagesList.innerHTML = "";
  if (!activeFriend) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Valj en van for att chatta.";
    messagesList.appendChild(empty);
    return;
  }
  const data = await api(`/api/messages?with=${encodeURIComponent(activeFriend)}`);
  for (const item of data.messages) {
    const text = await decryptMessage(item);
    const bubble = document.createElement("div");
    bubble.className = `message ${item.from === me.username ? "mine" : "theirs"}`;
    bubble.textContent = text;
    messagesList.appendChild(bubble);
    renderAttachments(item.attachments || [], messagesList);
  }
  messagesList.scrollTop = messagesList.scrollHeight;
}

async function refreshRequests() {
  const data = await api("/api/friend-requests");
  requestsList.innerHTML = "";
  if (data.incoming.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Inga forfragningar.";
    requestsList.appendChild(empty);
    return;
  }

  for (const username of data.incoming) {
    const row = document.createElement("div");
    row.className = "list-item";
    const label = document.createElement("p");
    label.textContent = `${username} vill bli van med dig`;
    label.style.margin = "0 0 8px";
    row.appendChild(label);
    row.appendChild(
      createButton("Acceptera", async () => {
        await api("/api/friend-requests/respond", {
          method: "POST",
          body: JSON.stringify({ from_username: username, accept: true }),
        });
        await refreshAllLists();
      }),
    );
    row.appendChild(
      createButton("Neka", async () => {
        await api("/api/friend-requests/respond", {
          method: "POST",
          body: JSON.stringify({ from_username: username, accept: false }),
        });
        await refreshAllLists();
      }),
    );
    requestsList.appendChild(row);
  }
}

async function refreshAllLists() {
  await refreshMe();
  if (!me.is_guest) {
    await refreshFriends();
    await refreshRequests();
    await refreshMessages();
  } else {
    await refreshGuestMessages();
  }
}

showLoginBtn.addEventListener("click", () => setAuthMode("login"));
showSignupBtn.addEventListener("click", () => setAuthMode("signup"));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = usernameInput.value;
  const password = passwordInput.value;
  const endpoint = authMode === "login" ? "/api/login" : "/api/signup";
  try {
    authStatus.textContent = "Vantar...";
    const data = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setToken(data.token);
    switchToApp();
    setActiveTab(data.user.is_guest ? "global" : "chattar");
    await refreshAllLists();
    await ensureLocalKeypair();
    startPolling();
    authStatus.textContent = "";
  } catch (err) {
    authStatus.textContent = err.message;
  }
});

guestBtn.addEventListener("click", async () => {
  try {
    const data = await api("/api/guest-login", { method: "POST", body: JSON.stringify({}) });
    setToken(data.token);
    switchToApp();
    setActiveTab("global");
    await refreshAllLists();
    startPolling();
  } catch (err) {
    authStatus.textContent = err.message;
  }
});

logoutBtn.addEventListener("click", () => {
  setToken("");
  me = null;
  activeFriend = null;
  switchToAuth();
});

for (const tab of tabs) {
  tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
}

addFriendForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const toUsername = addFriendInput.value;
  try {
    await api("/api/friend-request", {
      method: "POST",
      body: JSON.stringify({ to_username: toUsername }),
    });
    friendStatus.textContent = "Forfragan skickad.";
    addFriendInput.value = "";
    await refreshRequests();
  } catch (err) {
    friendStatus.textContent = err.message;
  }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeFriend || me?.is_guest) return;
  const content = messageInput.value;
  const attachments = await filesToPayload(fileInput.files);
  const encrypted = await encryptForFriend(activeFriend, content, attachments);
  try {
    await api("/api/proxy/send", {
      method: "POST",
      body: JSON.stringify({
        to_username: activeFriend,
        content: "",
        encrypted: true,
        cipher: encrypted.cipher,
        iv: encrypted.iv,
        keys: encrypted.keys,
        attachments: [],
      }),
    });
    messageInput.value = "";
    fileInput.value = "";
    await refreshMessages();
  } catch (err) {
    friendStatus.textContent = err.message;
  }
});

avatarForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/avatar", {
      method: "POST",
      body: JSON.stringify({ avatar_url: avatarInput.value }),
    });
    profileStatus.textContent = "Profilbild sparad.";
    await refreshMe();
  } catch (err) {
    profileStatus.textContent = err.message;
  }
});

globalMessageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!me?.is_guest) return;
  try {
    const attachments = await filesToPayload(globalFileInput.files);
    await api("/api/guest-messages", {
      method: "POST",
      body: JSON.stringify({ content: globalMessageInput.value, attachments }),
    });
    globalMessageInput.value = "";
    globalFileInput.value = "";
    await refreshGuestMessages();
  } catch (err) {
    friendStatus.textContent = err.message;
  }
});

darkModeToggle.addEventListener("change", saveSettingsFromUi);
highContrastToggle.addEventListener("change", saveSettingsFromUi);
fontScaleSelect.addEventListener("change", saveSettingsFromUi);
reducedMotionToggle.addEventListener("change", saveSettingsFromUi);

async function startup() {
  loadSettings();
  if (!getToken()) {
    setAuthMode("login");
    return;
  }
  try {
    switchToApp();
    setActiveTab("chattar");
    await refreshAllLists();
    await ensureLocalKeypair();
    startPolling();
  } catch {
    setToken("");
    switchToAuth();
  }
}

startup();

async function ensureLocalKeypair() {
  if (!me || me.is_guest) return;
  const keyId = `${PRIVATE_KEY_PREFIX}${me.username}`;
  const storedPrivate = localStorage.getItem(keyId);
  if (!storedPrivate) {
    const pair = await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["encrypt", "decrypt"],
    );
    const pub = await crypto.subtle.exportKey("spki", pair.publicKey);
    const priv = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
    localStorage.setItem(keyId, arrayBufferToBase64(pub));
    localStorage.setItem(`${keyId}_priv`, arrayBufferToBase64(priv));
    await api("/api/public-key", {
      method: "POST",
      body: JSON.stringify({ public_key: arrayBufferToBase64(pub) }),
    });
  } else {
    await api("/api/public-key", {
      method: "POST",
      body: JSON.stringify({ public_key: storedPrivate }),
    });
  }
}

async function getMyPrivateKey() {
  const keyId = `${PRIVATE_KEY_PREFIX}${me.username}_priv`;
  const raw = localStorage.getItem(keyId);
  if (!raw) throw new Error("Privat nyckel saknas");
  const buf = base64ToArrayBuffer(raw);
  return crypto.subtle.importKey(
    "pkcs8",
    buf,
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["decrypt"],
  );
}

async function getPublicKeyForUser(username) {
  const data = await api(`/api/public-key?username=${encodeURIComponent(username)}`);
  if (!data.public_key) throw new Error("Publik nyckel saknas");
  return crypto.subtle.importKey(
    "spki",
    base64ToArrayBuffer(data.public_key),
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["encrypt"],
  );
}

async function encryptForFriend(friendUsername, content, attachments) {
  const payloadObj = { content, attachments };
  const plaintext = new TextEncoder().encode(JSON.stringify(payloadObj));
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext);
  const exportedAes = await crypto.subtle.exportKey("raw", aesKey);
  const friendPub = await getPublicKeyForUser(friendUsername);
  const myPub = await getPublicKeyForUser(me.username);
  const keyForFriend = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, friendPub, exportedAes);
  const keyForMe = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, myPub, exportedAes);
  return {
    cipher: arrayBufferToBase64(cipher),
    iv: arrayBufferToBase64(iv.buffer),
    keys: {
      [friendUsername]: arrayBufferToBase64(keyForFriend),
      [me.username]: arrayBufferToBase64(keyForMe),
    },
  };
}

async function decryptMessage(item) {
  if (!item.encrypted) return item.content || "";
  const encryptedKey = (item.keys || {})[me.username];
  if (!encryptedKey) return "[Kan inte lasa meddelandet]";
  try {
    const privateKey = await getMyPrivateKey();
    const aesRaw = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      base64ToArrayBuffer(encryptedKey),
    );
    const aesKey = await crypto.subtle.importKey(
      "raw",
      aesRaw,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(base64ToArrayBuffer(item.iv)) },
      aesKey,
      base64ToArrayBuffer(item.cipher),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain));
    item.attachments = parsed.attachments || [];
    return parsed.content || "";
  } catch {
    return "[Dekryptering misslyckades]";
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function filesToPayload(fileList) {
  const files = Array.from(fileList || []);
  const out = [];
  for (const file of files) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Fil kunde inte lasas"));
      reader.readAsDataURL(file);
    });
    out.push({ name: file.name, type: file.type, data: dataUrl });
  }
  return out;
}

function renderAttachments(attachments, container) {
  for (const att of attachments) {
    const wrap = document.createElement("div");
    wrap.className = "attachment";
    if ((att.type || "").startsWith("image/")) {
      const img = document.createElement("img");
      img.src = att.data;
      img.alt = att.name || "Bild";
      wrap.appendChild(img);
    } else if ((att.type || "").startsWith("video/")) {
      const video = document.createElement("video");
      video.src = att.data;
      video.controls = true;
      wrap.appendChild(video);
    } else {
      const link = document.createElement("a");
      link.href = att.data;
      link.download = att.name || "fil";
      link.textContent = `Ladda ner: ${att.name || "fil"}`;
      wrap.appendChild(link);
    }
    container.appendChild(wrap);
  }
}

async function refreshGuestMessages() {
  if (!me?.is_guest) return;
  const data = await api("/api/guest-messages");
  globalMessagesList.innerHTML = "";
  for (const msg of data.messages) {
    const bubble = document.createElement("div");
    bubble.className = "message theirs";
    bubble.textContent = `${msg.from}: ${msg.content}`;
    globalMessagesList.appendChild(bubble);
    renderAttachments(msg.attachments || [], globalMessagesList);
  }
}

function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  const settings = raw
    ? JSON.parse(raw)
    : { dark: false, contrast: false, fontScale: "1", reducedMotion: true };
  darkModeToggle.checked = !!settings.dark;
  highContrastToggle.checked = !!settings.contrast;
  fontScaleSelect.value = settings.fontScale || "1";
  reducedMotionToggle.checked = settings.reducedMotion !== false;
  applySettings(settings);
}

function saveSettingsFromUi() {
  const settings = {
    dark: darkModeToggle.checked,
    contrast: highContrastToggle.checked,
    fontScale: fontScaleSelect.value,
    reducedMotion: reducedMotionToggle.checked,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  applySettings(settings);
}

function applySettings(settings) {
  document.body.classList.toggle("dark", !!settings.dark);
  document.body.classList.toggle("high-contrast", !!settings.contrast);
  document.documentElement.style.setProperty("--font-scale", settings.fontScale || "1");
  if (settings.reducedMotion) {
    document.documentElement.style.setProperty("scroll-behavior", "auto");
  }
}

function stopPolling() {
  if (guestPollHandle) clearInterval(guestPollHandle);
  if (dmPollHandle) clearInterval(dmPollHandle);
  guestPollHandle = null;
  dmPollHandle = null;
}

function startPolling() {
  stopPolling();
  // Lightweight polling for low-end devices.
  dmPollHandle = setInterval(() => {
    if (!me || me.is_guest || !activeFriend) return;
    refreshMessages();
  }, 1000);
  guestPollHandle = setInterval(() => {
    if (!me || !me.is_guest) return;
    refreshGuestMessages();
  }, 1000);
}
