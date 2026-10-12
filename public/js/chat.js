"use strict";

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendEl = document.getElementById("send");
const composerEl = document.getElementById("composer");
const whoEl = document.getElementById("who");
const threadEl = document.getElementById("thread");

let sessionId = null;
let pending = false;
let received = false;

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, text) {
  const el = document.createElement("div");
  el.className = `message message--${role}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function lastAssistant() {
  const last = messagesEl.lastElementChild;
  return last && last.classList.contains("message--assistant") ? last : null;
}

function appendToLastAssistant(text) {
  const el = lastAssistant();
  if (el) {
    el.textContent += text;
    scrollToBottom();
  }
}

function replaceLastAssistant(text) {
  const el = lastAssistant();
  if (el) {
    el.textContent = text;
    scrollToBottom();
  }
}

function setPending(value) {
  pending = value;
  sendEl.disabled = value;
}

async function loadUser() {
  try {
    const response = await fetch("/api/me");
    if (response.status === 401) {
      location.href = "/login";
      return;
    }
    const user = await response.json();
    whoEl.textContent = user.name;
    addMessage("assistant", `Hi ${user.name}, how can I help?`);
  } catch {
    whoEl.textContent = "you";
  }
}

function handleFrame(frame) {
  if (frame.type === "meta") {
    sessionId = frame.sessionId;
    threadEl.hidden = false;
    threadEl.textContent = `agent thread: ${frame.sessionId} · ${
      frame.resumed ? "resumed" : "new"
    }`;
  } else if (frame.type === "delta") {
    received = true;
    appendToLastAssistant(frame.text);
  } else if (frame.type === "done") {
    if (!received && frame.reply) {
      received = true;
      replaceLastAssistant(frame.reply);
    }
  } else if (frame.type === "error") {
    if (received) {
      appendToLastAssistant(`\n\n[${frame.error}]`);
    } else {
      received = true;
      replaceLastAssistant(frame.error);
    }
  }
}

composerEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text || pending) return;

  addMessage("user", text);
  addMessage("assistant", "");
  inputEl.value = "";
  received = false;
  setPending(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Send the thread id back once we have one, so the BFF exercises the
      // explicit-resume + ownership path instead of just "active thread".
      body: JSON.stringify({ message: text, sessionId }),
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => null);
      replaceLastAssistant(
        (data && data.error) || "Request failed. Please try again.",
      );
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const dataLine = raw
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;

        let frame;
        try {
          frame = JSON.parse(dataLine.slice(5).trimStart());
        } catch {
          continue;
        }
        handleFrame(frame);
      }
    }

    if (!received) {
      replaceLastAssistant("No reply from server.");
    }
  } catch {
    replaceLastAssistant("Request failed. Please try again.");
  } finally {
    setPending(false);
  }
});

loadUser();
