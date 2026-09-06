self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Nouveau message", body: event.data ? event.data.text() : "" };
  }

  const isCall = payload.kind === "call";
  const title = payload.title || (isCall ? "Appel entrant" : "Nouveau message");
  const options = {
    body: payload.body || (isCall ? "Touchez pour répondre" : "Tu as reçu un nouveau message."),
    tag: isCall
      ? `call-${payload.callId || "incoming"}`
      : payload.conversationId
        ? `conversation-${payload.conversationId}`
        : "manuel-pro-message",
    renotify: true,
    requireInteraction: isCall,
    silent: false,
    data: {
      url: payload.url || "/",
      kind: payload.kind || "message",
      callId: payload.callId || null,
      callType: payload.callType || null,
    },
    actions: isCall ? [{ action: "open", title: "Répondre" }] : [],
  };

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visibleWindows = windows.filter((client) => client.visibilityState === "visible" || client.focused === true);

    if (visibleWindows.length > 0) {
      for (const client of visibleWindows) {
        client.postMessage({
          type: "MANUEL_PRO_IN_APP_PUSH",
          payload: {
            kind: payload.kind || "message",
            callType: payload.callType || null,
            title,
            body: options.body,
            conversationId: payload.conversationId,
            callId: payload.callId,
            url: payload.url || "/",
          },
        });
      }
      return;
    }

    await self.registration.showNotification(title, options);
    if (self.navigator && typeof self.navigator.setAppBadge === "function") {
      try { await self.navigator.setAppBadge(); } catch {}
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        if ("navigate" in client) await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
  })());
});
