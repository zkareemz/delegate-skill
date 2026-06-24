/**
 * delegate-skill · adapter · pi
 *
 * Drives the `pi` CLI (https://npmjs and the pi project) as a background
 * implementer. Everything pi-specific lives here; the engine stays generic.
 *
 * pi's non-interactive mode is `pi -p --mode json <prompt>`:
 *   - `--mode json` streams JSONL events on stdout (one event per line).
 *   - the first `{"type":"session", "id": "..."}` event carries the session id.
 *   - the terminal `{"type":"agent_end", "messages":[...]}` event carries the full
 *     message list; `{"type":"turn_end"|"message_end", "message":{role:"assistant"...}}`
 *     carry the assistant message of each turn.
 *   - an assistant message's `content[]` mixes `{type:"thinking"}` and `{type:"text"}`;
 *     the human-readable report is the joined `text` parts.
 *   - pi has no `--cd`/`--dir` flag; the engine sets the child process cwd instead.
 *   - `--session-id <id>` is honored verbatim ("creating it if missing"), so reusing
 *     the same id continues the conversation — that's how resume/rework works.
 *
 * Confirmed against pi v0.79.8.
 */

import type { Adapter, RunContext } from "../engine/types";

interface PiTextPart {
  type?: string;
  text?: string;
}
interface PiMessage {
  role?: string;
  content?: PiTextPart[];
}
interface PiEvent {
  type?: string;
  id?: string;
  message?: PiMessage;
  messages?: PiMessage[];
}

function parseLines(events: string): PiEvent[] {
  const out: PiEvent[] = [];
  for (const line of events.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as PiEvent);
    } catch {
      /* non-JSON progress line — ignore */
    }
  }
  return out;
}

/** Join the `text` parts of an assistant message, dropping `thinking` content. */
function assistantText(msg: PiMessage | undefined): string {
  if (!msg || !Array.isArray(msg.content)) return "";
  return msg.content
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("")
    .trim();
}

function buildBase(ctx: RunContext): string[] {
  const { opts, sessionId } = ctx;
  const argv = ["-p", "--mode", "json", "--session-id", sessionId];
  if (opts.model) argv.push("-m", opts.model);
  if (opts.provider) argv.push("--provider", opts.provider);
  return argv;
}

export const piAdapter: Adapter = {
  name: "pi",
  versionArgv: ["--version"],
  sendBrief: "argv",

  buildArgv: buildBase,
  // pi continues a conversation by reusing the same --session-id, so resume argv is identical.
  buildResumeArgv: buildBase,

  parseSessionId(events) {
    for (const event of parseLines(events)) {
      if (event.type === "session" && typeof event.id === "string") return event.id;
    }
    return null;
  },

  parseFinalMessage(events) {
    let agentEndMessages: PiMessage[] | null = null;
    let lastTurnAssistant: PiMessage | undefined;
    for (const event of parseLines(events)) {
      if (event.type === "agent_end" && Array.isArray(event.messages)) {
        agentEndMessages = event.messages;
      }
      const msg = event.message;
      if (
        msg &&
        msg.role === "assistant" &&
        (event.type === "turn_end" || event.type === "message_end")
      ) {
        lastTurnAssistant = msg;
      }
    }
    // Prefer the definitive terminal event's last assistant message.
    if (agentEndMessages) {
      for (let i = agentEndMessages.length - 1; i >= 0; i -= 1) {
        if (agentEndMessages[i]?.role === "assistant") {
          const text = assistantText(agentEndMessages[i]);
          if (text) return text;
        }
      }
    }
    return assistantText(lastTurnAssistant);
  },
};
