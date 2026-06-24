/**
 * delegate-skill · entry · delegate-pi
 *
 * Thin per-skill entry point: pick the pi adapter and run the target-agnostic engine.
 * tsup bundles this into skills/delegate-pi/scripts/relay.mjs.
 */
import { main } from "../engine/index";
import { piAdapter } from "../adapters/pi";

main(piAdapter);
