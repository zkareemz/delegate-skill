/**
 * delegate-skill · entry · delegate-opencode
 *
 * Thin per-skill entry point: pick the opencode adapter and run the target-agnostic
 * engine. tsup bundles this into skills/delegate-opencode/scripts/relay.mjs.
 */
import { main } from "../engine/index";
import { opencodeAdapter } from "../adapters/opencode";

main(opencodeAdapter);
