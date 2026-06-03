// sw.js — service worker voor pushberichten.
// Plaats dit in /public zodat het op de site-root wordt geserveerd (/sw.js).

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || "Budgetboek";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",   // optioneel; plaats een eigen icoon of laat weg
    badge: data.badge || "/badge.png",     // idem
    tag: data.tag,                          // zelfde tag vervangt een eerdere melding
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) if ("focus" in client) { client.navigate(url); return client.focus(); }
      return self.clients.openWindow(url);
    })
  );
});

// --- PWA-levenscyclus (installeerbaarheid) ---
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
// Lege fetch-handler: sommige browsers vereisen er een om de app installeerbaar te achten.
self.addEventListener("fetch", () => {});
