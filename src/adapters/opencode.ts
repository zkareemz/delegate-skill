/**
 * delegate-skill · adapter · opencode
 *
 * Drives the `opencode` CLI (https://opencode.ai) as a background implementer.
 * Everything opencode-specific lives here; the engine stays generic.
 *
 * opencode's non-interactive mode is `opencode run --format json <prompt>`:
 *   - `--format json` streams one JSON event per line on stdout.
 *   - every event carries a top-level `sessionID` ("ses_…"); opencode mints this
 *     itself, so the engine recovers it from the stream rather than assigning one.
 *   - assistant prose arrives as `{"type":"text", "part":{type:"text","text":...,
 *     "messageID":...}}` events; tool calls / step markers are separate event types
 *     carrying no `part.text`.
 *   - the final report is the `text` parts of the LAST assistant message (grouped by
 *     `part.messageID`), which excludes earlier narration around tool calls.
 *   - opencode applies edits to the working tree in `run` mode without a sandbox flag;
 *     it has a `--dir` flag, but the engine sets the child process cwd instead.
 *   - a session is continued with `--session <ses_id>` — that's how resume/rework works.
 *   - the model is a single `provider/model` string passed via `-m`.
 *
 * Confirmed against opencode v1.17.9.
 */

import type { Adapter, RunContext } from "../engine/types";

interface OcPart {
  type?: string;
  text?: string;
  messageID?: string;
}
interface OcEvent {
  type?: string;
  sessionID?: string;
  part?: OcPart;
}

function parseLines(events: string): OcEvent[] {
  const out: OcEvent[] = [];
  for (const line of events.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as OcEvent);
    } catch {
      /* non-JSON progress line — ignore */
    }
  }
  return out;
}

/**
 * opencode takes the model as one `provider/model` string. Honor an already-qualified
 * `--model provider/model`; otherwise stitch a separate `--provider` in front of a bare
 * `--model`. Provider alone has no opencode flag, so it's left to opencode's default.
 */
function resolveModel(ctx: RunContext): string | null {
  const { model, provider } = ctx.opts;
  if (model && provider && !model.includes("/")) return `${provider}/${model}`;
  return model;
}

export const opencodeAdapter: Adapter = {
  name: "opencode",
  versionArgv: ["--version"],
  sendBrief: "argv",

  buildArgv(ctx) {
    // Fresh dispatch. opencode mints its OWN ses_… id; we don't pass one and recover
    // the real id from the event stream in parseSessionId.
    const argv = ["run", "--format", "json"];
    const model = resolveModel(ctx);
    if (model) argv.push("-m", model);
    return argv;
  },

  buildResumeArgv(ctx) {
    // Continue the prior session by its real id (the ses_… echoed back via --session-id).
    return ["run", "--format", "json", "--session", ctx.sessionId];
  },

  parseSessionId(events) {
    for (const event of parseLines(events)) {
      if (typeof event.sessionID === "string" && event.sessionID) return event.sessionID;
    }
    return null;
  },

  parseFinalMessage(events) {
    // Collect assistant text parts in order; the final report is the parts belonging to
    // the LAST message (by messageID), joined — dropping narration around earlier tools.
    const parts: { messageID: string | undefined; text: string }[] = [];
    for (const event of parseLines(events)) {
      const part = event.part;
      if (event.type === "text" && part && typeof part.text === "string") {
        parts.push({ messageID: part.messageID, text: part.text });
      }
    }
    if (!parts.length) return "";
    const lastId = parts[parts.length - 1].messageID;
    const chosen = lastId ? parts.filter((p) => p.messageID === lastId) : [parts[parts.length - 1]];
    return chosen
      .map((p) => p.text)
      .join("")
      .trim();
  },
};
