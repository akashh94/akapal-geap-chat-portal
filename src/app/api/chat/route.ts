import { getSessionUserId } from "@/lib/dal";
import { readSessionToken } from "@/lib/session";

const BFF_URL = process.env.BFF_URL ?? "http://localhost:4000";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Disable buffering in front of the app (nginx-style reverse proxies).
  "X-Accel-Buffering": "no",
};

function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

// BFF seam: this route hands the turn to the BFF, which owns the
// user_id -> agent session_id mapping and the authorization check. The portal's
// job is only to prove who the user is (its own session JWT) and forward.
//
// The BFF replies with a text/event-stream of frames
// ({type:"meta"|"delta"|"done"|"error"}); we relay it to the browser verbatim
// so tokens render as they arrive instead of after the whole turn.
export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    sessionId?: unknown;
  } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const token = (await readSessionToken()) ?? "";

  let upstream: Response;
  try {
    upstream = await fetch(`${BFF_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message, sessionId: body?.sessionId }),
    });
  } catch {
    return Response.json({ error: "BFF unreachable" }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  // Streaming BFF: relay the event stream straight through, unbuffered.
  if (upstream.ok && upstream.body && contentType.includes("text/event-stream")) {
    return new Response(upstream.body, { status: 200, headers: SSE_HEADERS });
  }

  // Non-streaming BFF (or an error): read the JSON and normalise it to one SSE
  // document, so the browser only ever has to understand one protocol.
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || !data) {
    return Response.json(data ?? { error: "Bad response from BFF" }, {
      status: upstream.status || 502,
    });
  }

  const reply = typeof data.reply === "string" ? data.reply : "";
  const frames =
    sseFrame({
      type: "meta",
      userId: data.userId,
      sessionId: data.sessionId,
      resumed: data.resumed,
    }) +
    (reply ? sseFrame({ type: "delta", text: reply }) : "") +
    sseFrame({ type: "done", reply });

  return new Response(frames, { status: 200, headers: SSE_HEADERS });
}
