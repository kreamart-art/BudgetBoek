// push.js — regelt het in-/uitschakelen van pushberichten in de browser.
// Draai dit in je eigen frontend (niet in een Claude-artifact).

const API_URL = (import.meta.env && import.meta.env.VITE_API_URL) || "http://localhost:4000";
const TOKEN_KEY = "budget_token";

const authHeaders = () => {
  const t = localStorage.getItem(TOKEN_KEY);
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export const push = {
  supported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  },

  // { supported, enabled, permission }
  async status() {
    if (!this.supported()) return { supported: false, enabled: false, permission: "unsupported" };
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return { supported: true, enabled: !!sub, permission: Notification.permission };
  },

  async enable() {
    if (!this.supported()) throw new Error("Deze browser ondersteunt geen pushberichten.");
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Je hebt geen toestemming gegeven voor meldingen.");

    const res = await fetch(`${API_URL}/api/push/key`, { headers: authHeaders() });
    const { key } = await res.json();
    if (!key) throw new Error("De server heeft geen pushsleutel ingesteld.");

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await fetch(`${API_URL}/api/push/subscribe`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ subscription: sub }) });
    return true;
  },

  async disable() {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await fetch(`${API_URL}/api/push/unsubscribe`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  },

  async sendTest() {
    const res = await fetch(`${API_URL}/api/push/test`, { method: "POST", headers: authHeaders() });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || "Testmelding mislukt"); }
  },
};
