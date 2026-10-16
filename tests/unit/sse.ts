import Anthropic from "@anthropic-ai/sdk";

/** A finished assistant message to stream: its content blocks and how it stopped. */
export interface StreamedMessage {
  stop_reason: string;
  content: Array<{ type: "text"; text: string } | ({ type: string } & Record<string, unknown>)>;
  model?: string;
}

/**
 * The server-sent events the Messages API would send for `message`: message_start, a
 * start/delta/stop triple per content block (text arrives in two deltas), message_delta with
 * the stop reason, message_stop.
 */
export function sseBody(message: StreamedMessage): string {
  const events: Array<[string, unknown]> = [];
  events.push([
    "message_start",
    {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: message.model ?? "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    },
  ]);
  message.content.forEach((block, index) => {
    if (block.type === "text") {
      const text = String(block.text);
      events.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "", citations: null },
        },
      ]);
      const half = Math.floor(text.length / 2);
      for (const part of [text.slice(0, half), text.slice(half)]) {
        events.push([
          "content_block_delta",
          { type: "content_block_delta", index, delta: { type: "text_delta", text: part } },
        ]);
      }
    } else {
      events.push([
        "content_block_start",
        { type: "content_block_start", index, content_block: block },
      ]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push([
    "message_delta",
    {
      type: "message_delta",
      delta: { stop_reason: message.stop_reason, stop_sequence: null },
      usage: { output_tokens: 20 },
    },
  ]);
  events.push(["message_stop", { type: "message_stop" }]);
  return events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
}

/**
 * A real SDK client whose HTTP layer streams `message`, so `stream()` and `finalMessage()` run
 * exactly as in production (including the structured-output parse of every text block), with
 * no network. Records each request's headers and body.
 */
export function streamingSdkClient(message: StreamedMessage) {
  const requests: { headers: Headers; body: Record<string, unknown> }[] = [];
  const client = new Anthropic({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (_url: unknown, init?: RequestInit) => {
      requests.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(sseBody(message), {
        status: 200,
        headers: { "content-type": "text/event-stream", "request-id": "req_test" },
      });
    },
  });
  return { client, requests };
}

export const fallbackBlock = {
  type: "fallback",
  from: { model: "claude-opus-5-5" },
  to: { model: "claude-opus-5" },
  trigger: { type: "refusal" },
};
