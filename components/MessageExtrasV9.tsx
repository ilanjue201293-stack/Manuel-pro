"use client";

import { useEffect } from "react";

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<]+/gi;
const TRAILING = /[.,!?;:)}\]]+$/;

function linkify(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    if (!text.data || text.parentElement?.closest("a")) continue;
    URL_RE.lastIndex = 0;
    if (URL_RE.test(text.data)) nodes.push(text);
  }

  for (const textNode of nodes) {
    const text = textNode.data;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    URL_RE.lastIndex = 0;

    for (const match of text.matchAll(URL_RE)) {
      const start = match.index ?? 0;
      const raw = match[0];
      const trailing = raw.match(TRAILING)?.[0] || "";
      const clean = trailing ? raw.slice(0, -trailing.length) : raw;
      if (!clean) continue;

      if (start > cursor) fragment.append(document.createTextNode(text.slice(cursor, start)));

      const anchor = document.createElement("a");
      anchor.href = clean.startsWith("www.") ? `https://${clean}` : clean;
      anchor.textContent = clean;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.className = "message-link-v9";
      anchor.style.color = "#58a9ff";
      anchor.style.textDecoration = "underline";
      anchor.style.textUnderlineOffset = "2px";
      anchor.style.overflowWrap = "anywhere";
      anchor.addEventListener("pointerdown", (event) => event.stopPropagation());
      anchor.addEventListener("pointerup", (event) => event.stopPropagation());
      anchor.addEventListener("click", (event) => event.stopPropagation());
      fragment.append(anchor);
      if (trailing) fragment.append(document.createTextNode(trailing));
      cursor = start + raw.length;
    }

    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  }
}

function makeCopyButton(article: HTMLElement) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.copyMessageV9 = "1";
  button.setAttribute("aria-label", "Copier le message");
  button.title = "Copier";
  button.textContent = "📋";
  button.style.flex = "0 0 auto";
  button.style.minWidth = "36px";

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const text = article.querySelector<HTMLElement>(".message-text")?.innerText.trim() || "";
    if (!text) return;
    const ok = await copyText(text).catch(() => false);
    if (!ok) return;
    button.textContent = "✓";
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = "📋";
    }, 900);
  });

  return button;
}

export default function MessageExtrasV9() {
  useEffect(() => {
    let queued = false;

    const sync = () => {
      queued = false;
      document.querySelectorAll<HTMLElement>(".message-text").forEach(linkify);

      document.querySelectorAll<HTMLElement>(".message-v3").forEach((article) => {
        const text = article.querySelector<HTMLElement>(".message-text")?.innerText.trim() || "";
        if (!text) return;

        const ownActions = article.querySelector<HTMLElement>(".own-message-actions-v7");
        if (ownActions && !ownActions.querySelector("[data-copy-message-v9]")) {
          ownActions.prepend(makeCopyButton(article));
        }

        const reactions = article.querySelector<HTMLElement>(".reactions-under-v7");
        if (reactions && !reactions.querySelector("[data-copy-message-v9]")) {
          const copy = makeCopyButton(article);
          copy.style.marginLeft = "4px";
          copy.style.borderLeft = "1px solid rgba(255,255,255,.12)";
          reactions.append(copy);
        }
      });
    };

    const schedule = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(sync);
    };

    sync();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
