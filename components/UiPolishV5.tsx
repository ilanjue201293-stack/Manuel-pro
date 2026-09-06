"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function updateSeenGroups() {
  const messages = Array.from(document.querySelectorAll<HTMLElement>(".message-v3"));
  messages.forEach((message) => message.classList.remove("seen-group-v5"));

  let group: HTMLElement[] = [];
  const flush = () => {
    if (!group.length) return;
    const last = group[group.length - 1];
    const isMine = group.every((message) => message.classList.contains("mine"));
    const seen = Boolean(last.querySelector(".seen-inline-v3"));
    if (isMine && seen) group.forEach((message) => message.classList.add("seen-group-v5"));
    group = [];
  };

  for (const message of messages) {
    if (message.classList.contains("group-start") && group.length) flush();
    group.push(message);
    if (message.classList.contains("group-end")) flush();
  }
  flush();
}

export default function UiPolishV5() {
  const [messagesHost, setMessagesHost] = useState<HTMLElement | null>(null);
  const [switching, setSwitching] = useState(false);
  const conversationRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const sync = () => {
      const host = document.querySelector<HTMLElement>(".messages");
      if (host !== messagesHost) setMessagesHost(host);

      const header = document.querySelector<HTMLElement>(".chat-head[data-conversation-id]");
      const id = header?.dataset.conversationId || null;
      if (id && id !== conversationRef.current) {
        conversationRef.current = id;
        setSwitching(true);
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setSwitching(false), 340);
      }

      updateSeenGroups();
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-conversation-id"],
    });

    return () => {
      observer.disconnect();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [messagesHost]);

  if (!messagesHost || !switching) return null;
  return createPortal(
    <div className="conversation-switch-loader-v5" aria-live="polite" aria-label="Chargement de la conversation">
      <span className="loader-ring-v5" />
    </div>,
    messagesHost,
  );
}
