# Security Map and Giotto

Open a project session card and select **Security Map**. The map is scoped to that session and its project. Click a box or relationship, or focus it and press Enter, to open the supporting evidence. Grouped activity lists its individual event IDs; select one to inspect that specific record. Findings use Vigil's existing finding detail panel and show their related event when recorded.

Blue dashed actions are attempts, red actions are denied or failed, green actions are returned tools, and yellow boxes are findings. A returned tool does **not** establish successful file access or network delivery. Resource relationships are labeled as references in recorded inputs. Denied actions remain denied, even when other actions return successfully.

## Dependency and setup

Run `npm install` and `npm run build` as before. Giotto is a local dependency at `vendor/giotto`, pinned to reviewed upstream commit [`4c06069944fd0f515e4e7bf89b9cca8398cd7936`](https://github.com/nicoloboschi/giotto/tree/4c06069944fd0f515e4e7bf89b9cca8398cd7936). `UPSTREAM.json` records original Git blob hashes, and tests verify the snapshot. Upstream JS and HTML are unmodified. The packaging manifest excludes the unused native PNG dependency; `upstream-package.json` preserves the upstream manifest. JSON/SVG rendering requires no native image library, Chrome, external fonts, Giotto installer, or global MCP configuration. Upstream declares MIT in its package manifest.

The reviewed interfaces are `giotto/player`, its `doc` property, `autoplay="false"`, and documented `--fig-*` theme variables. The verified renderer emits `data-id` on SVG groups in the player's open shadow root. Vigil delegates selection there and accepts only IDs in its evidence mapping. The wrapper removes listeners and the element on cleanup, catches loading/rendering errors, and adds keyboard selection. Export uses `giotto/figure`'s `figureSvg` and checks the complete output, including `giotto-doc` metadata.

## Evidence and live updates

`GET /api/security-map?session=<id>` derives the diagram from normalized SQLite events/findings and returns a separate element-to-evidence mapping plus its supporting records. The existing WebSocket state stream invalidates the selected map, with updates batched to at most four requests per second. Rendering failures leave monitoring and hook enforcement running. Maps are paused by default.

The map groups repeated tool activity by tool, action type, decision, resource references, rule, and simulation status. Identifiers are stable hashes; duplicate event IDs are removed. Hooks that supply `tool_use_id` receive stable evidence IDs per session and hook type, so retries are persisted once. Older hooks without invocation IDs cannot be reliably paired; the interface says so. No attempt/result link is inferred from timing alone.

The latest map and evidence mapping are saved in SQLite's `security_maps` table. Reloading restores the selected session/view from the URL and reconstructs the map from authoritative evidence. Saved snapshots and agent diagrams never update evidence or policy. Map generation is outside the hook decision path.

For readability, a live map shows the latest 30 events and up to 50 findings, grouping repetitive records. The session query is capped at 5,000 events and 1,000 findings with explicit notices when reached. Older evidence remains stored in SQLite. File references come from explicit file fields or a limited simple direct-read command parser. Destination references show only HTTP(S) origins. MCP server names come from supported tool-name conventions or explicit server fields. Other resources are marked unavailable. Shell scripts, interpreters, aliases, subprocess internals, and MCP server internals can contain unreported operations.

## Explain visually

Open a finding and choose **Explain visually**. For a linked event, Vigil shows the two preceding and two following recorded events from the same session, with plain-language steps, event IDs and timestamps. Previous/Next controls synchronize with Giotto's reviewed paused scene controls. Scenes only highlight elements and narrate; they do not animate a blocked transfer. Scanner findings without an associated event explicitly have no observed sequence. Simulated records retain their labels. Temporal adjacency is not proof of causality.

Giotto respects reduced-motion preferences for packet animation and autoplay; Vigil disables autoplay and caption transitions for reduced motion. No model analysis is performed by this integration.

## Optional agent-authored architecture

```bash
node dist/cli.js run --project "$PWD/demo/project" \
  --policy "$PWD/demo/policy.json" --giotto-mcp
```

Vigil supplies session-only Codex `-c mcp_servers.vigil_giotto...` overrides. It does not edit global MCP settings or the monitored project. The optional stdio sidecar uses a controlled `GIOTTO_DIR` under the Vigil data directory and rejects a directory inside the monitored project, including resolved symlinks. The sidecar's lock and health file are private. On EOF or shutdown it reports stopped and removes its lock. An abnormal termination can leave a stale lock; starting a new Vigil session uses a new directory. No other instance is killed.

The restricted sidecar uses Giotto's editing engine and a reviewed subset of upstream schemas for `list_diagrams`, `create_diagram`, `get_diagram` and `edit_diagram`. It deliberately does not run upstream's canvas launcher, which can replace another canvas on a shared port. This sidecar uses no ports, so it cannot collide with another Giotto canvas. Arbitrary pages, images, external resources, styles, export paths and scene edits are unavailable. Inputs are validated and redacted before storage and tool responses.

Choose **Agent architecture** in the Security Map to see health and authored diagrams. Every architecture relation is labeled **Inferred**, uses a dashed arrow, and has no verified event/finding mapping. Ask the agent to use the session's `vigil_giotto` tools to draw a project architecture explanation. Authored diagrams live in a separate directory and cannot overwrite the map generated from security evidence. They remain available after the sidecar stops. Sidecar startup failure is optional for Codex; the console reports unavailable while monitoring continues.

## Synthetic walkthrough

For a deterministic demonstration without Codex, run `npm run fixture`, open `http://127.0.0.1:4317`, open the example session, and choose **Security Map**. The denied protected-file attempt and policy finding are labeled simulated. Select the action, file reference, decision, or finding to inspect its supporting records. Choose **Explain visually** on the finding and step through the recorded sequence. Export JSON and SVG from the map.

To exercise a real monitored Codex session with non-functional demo credentials:

```bash
npm run build
node dist/cli.js run --project "$PWD/demo/project" \
  --policy "$PWD/demo/policy.json" --no-open
```

Open the printed dashboard URL and the new session's Security Map. Ask Codex to run `cat README.md`, then ask it to run `cat secrets/credentials.env`. The first attempt and any recorded response should update separately. The protected-file attempt should be denied before execution and generate a policy finding. Select its map element to inspect the event, affected resource and policy rule. Open the finding and choose Explain visually. Export JSON/SVG and reload the URL; the map should retain its IDs and evidence links. The synthetic credential values must not appear in labels, snapshots, or exports. Do not revise the policy to read the credential file for this walkthrough.

## Validation and limits

```bash
npm test
npm run typecheck
npm run build
npm run test:security-map:browser
```

The browser smoke test needs a local Chrome installation and permission to start localhost services. Set `CHROME_BIN` if Chrome is elsewhere. It sends synthetic envelopes to the actual HTTP hook handler, verifies a live embedded map, selects a denied element, checks its evidence panel, records a returned tool, reloads, checks JSON/SVG redaction, and verifies that invalid-diagram rendering does not interrupt denial. It does not launch Codex or prove that a subprocess executed.

Implementation validation in the restricted workspace: typechecking and build pass; 18 tests covering adapters, upstream rendering, selection ID filtering, exports/metadata, redaction, scanner behavior, SQLite migration and stdio lifecycle pass. The two HTTP service tests cannot bind localhost (`EPERM`), and Chrome cannot launch here. HTTP and browser end-to-end validation therefore remain pending on a normal development machine.

This remains a local security console with its existing enforcement coverage. It has no multi-machine ingestion or tenant authentication. Redaction uses bounded structural traversal, credential patterns, sensitive key names and known session secrets; it does not claim to identify every arbitrary secret in free-form text. The map omits raw command text, responses and file content from its labels. SQLite evidence remains authoritative, and diagram edits cannot broaden enforcement coverage.
