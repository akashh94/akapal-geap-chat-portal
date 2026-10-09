"use client";

import { useState } from "react";

type Message = { role: "user" | "assistant"; text: string };

type SseFrame =
  | { type: "meta"; userId: string; sessionId: string; resumed: boolean }
  | { type: "delta"; text: string }
  | { type: "done"; reply: string }
  | { type: "error"; error: string };

export function ChatWindow({ userName }: { userName: string }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: `Hi ${userName}, how can I help?` },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [thread, setThread] = useState("");

  function appendToLastAssistant(text: string) {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        next[next.length - 1] = { ...last, text: last.text + text };
      }
      return next;
    });
  }

  function replaceLastAssistant(text: string) {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        next[next.length - 1] = { ...last, text };
      }
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || pending) {
      return;
    }

    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      { role: "assistant", text: "" },
    ]);
    setInput("");
    setPending(true);

    let received = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send the thread id back once we have one, so the BFF exercises the
        // explicit-resume + ownership path instead of just "active thread".
        body: JSON.stringify({ message: text, sessionId }),
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        replaceLastAssistant(data?.error ?? "Request failed. Please try again.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          const dataLine = raw
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (!dataLine) continue;

          let frame: SseFrame;
          try {
            frame = JSON.parse(dataLine.slice(5).trimStart()) as SseFrame;
          } catch {
            continue;
          }

          if (frame.type === "meta") {
            setSessionId(frame.sessionId);
            setThread(`${frame.sessionId} · ${frame.resumed ? "resumed" : "new"}`);
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
      }

      if (!received) {
        replaceLastAssistant("No reply from server.");
      }
    } catch {
      replaceLastAssistant("Request failed. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {thread && (
        <p className="text-xs text-zinc-500">agent thread: {thread}</p>
      )}

      <div className="flex flex-1 flex-col gap-2">
        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "self-end rounded bg-black px-3 py-2 text-white dark:bg-white dark:text-black"
                : "self-start rounded bg-zinc-100 px-3 py-2 dark:bg-zinc-800"
            }
          >
            {message.text ||
              (pending && index === messages.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type a message…"
          className="flex-1 rounded border px-3 py-2 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Send
        </button>
      </form>
    </div>
  );
}
