# Vigil

Vigil is a local security dashboard around an existing OpenAI Codex CLI. It launches Codex in the selected project with a generated session profile and documented lifecycle hooks, records redacted activity in SQLite, applies an explicit protected-path rule to supported direct shell reads, and streams evidence to a localhost dashboard.

## Requirements

- Node.js 22.5+ (uses the built-in `node:sqlite` module; Node 24+ recommended)
- Codex CLI with stable hooks support installed and authenticated (`codex --version`; tested with `codex-cli 0.162.1`)
- Optional: Gitleaks on `PATH`

## Setup

```bash
npm install
npm run build
npm link
```

`npm run build` creates the dashboard and the executable hook/CLI bundles. `npm link` makes the local `vigil` command available; alternatively use `node dist/cli.js ...`.

## Run with your project

```bash
vigil run --project "/absolute/path/to/your/project"
```

Vigil opens the local dashboard and starts an interactive Codex session. The board shows your recorded sessions. Open a card to see activity and anything that needs attention. Security checks and technical information are under **More details**.

To supply a protected-file policy, keep its JSON file outside the monitored project:

```bash
vigil run --project "/absolute/path/to/your/project" --policy "/absolute/path/to/policy.json"
```

The policy has a `protectedPaths` array containing paths relative to the project. Supported direct shell reads of those files are blocked. Other actions continue through Codex's existing permission checks.

Pass additional Codex CLI arguments after `--`:

```bash
vigil run --project "/absolute/path/to/your/project" -- --ask-for-approval on-request --sandbox workspace-write
```

Vigil stores its database, generated hook profile copy, and default policy under `~/.vigil`, outside the selected project. It creates a uniquely named active profile under `$CODEX_HOME` (normally `~/.codex`) for the process and removes it when Codex exits. Override the data root with `VIGIL_HOME` for testing.

Run multiple `vigil run` commands in separate terminals to monitor multiple sessions. If the dashboard port is occupied, the next session uses an available port. Dashboards sharing the same `VIGIL_HOME` show each other's live session updates.

## Preview one demo session

```bash
npm run build
npm run fixture
```

Open `http://127.0.0.1:4317`. The board has **Running**, **Completed**, and **Vulnerable** columns. Sessions with an unresolved security finding appear under Vulnerable, even if the task has finished. Other ended or stopped sessions appear under Completed; their badges retain the actual status.

The demo contains exactly one fictional task: **Update the café website**. It appears under Vulnerable because a password was found in the website draft. Open the card to see the vulnerability and recommended next step on the left, with its system map on the right. Scroll down to **Choose your tools** to try the demo switches. **Activity and security checks** contains the underlying records.

The card is labelled Demo. No agent is launched and no project files are read or changed. Each launch uses a fresh temporary database, separate from your real sessions. Press Ctrl+C to stop.

## Scanner behavior

- **Gitleaks:** if installed, Vigil runs `gitleaks dir <project> --report-format json --report-path <temporary-file> --redact --no-banner`. The report lives in an OS temporary directory, is removed after import, and secret/match values are never retained. Exit status, malformed output, and timeouts are shown as failed rather than clean.
- **Snyk Agent Scan:** Vigil detects the installed `snyk-agent-scan` version and provides a bounded JSON importer. Automatic execution remains unsupported until the installed version's command behavior is explicitly matched. It never starts MCP servers merely for inventory. Import an existing report without executing anything discovered in it:

  ```bash
  vigil import-snyk --file /path/to/report.json --session <session-id>
  ```
- **Lasso, Semgrep, Docker Sandboxes, Langfuse:** represented through the same adapter contract and shown as not installed, not configured, or unsupported. They are not active enforcement in this MVP.

## Exact coverage and guarantees

| Area | State | Meaning |
| --- | --- | --- |
| Supported direct Codex shell reads | Prevention | `PreToolUse` denies direct commands using common read utilities (`cat`, `head`, `tail`, `less`, `more`, `bat`, `sed`, `awk`, `grep`, `rg`, `xxd`, `strings`, `wc`, or `cp`) when the command text contains a configured protected path. Existing paths are canonicalized. |
| Other native tools and commands | Detection only | Attempts/results are recorded, but this MVP has no deny policy for them. Passing Vigil returns no permission override. |
| Shell indirection and subprocesses | Unsupported by this rule | Interpreters, aliases, variables, dynamically constructed paths, encoded commands, and child processes can bypass this lexical check. Use an OS-level sandbox when protected-file confidentiality is a required boundary. Codex's `read-only` and `workspace-write` modes primarily constrain writes and must not be described as deny-read controls. |
| MCP tools | Unsupported by this rule | Activity can be observed by hooks, but this path policy does not enforce MCP server behavior. |
| Service outage | Fail closed for supported direct reads | The hook bridge carries resolved protected paths and denies a matching supported direct shell read when the policy HTTP service cannot be reached. Other actions receive no override. A killed hook process or disabled hooks cannot provide this guarantee. |
| Gitleaks | Detection | Real scan only when installed; unavailable, failed, clean, and findings states remain distinct. |

Codex's `--profile` option layers Vigil's generated hook profile over the normal user configuration. Vigil does not set `--dangerously-bypass-approvals-and-sandbox`, `--ask-for-approval`, or `--sandbox`, and it never emits an allow decision. It does pass `--dangerously-bypass-hook-trust` so the generated ephemeral hook can run without a manual `/hooks` trust step. In Codex this flag bypasses hook-source review, not command approvals or the execution sandbox; however, it can also trust other discovered hooks for that invocation, so projects with unreviewed hooks remain a coverage risk.

Hook requests use a per-session bearer token. The HTTP/WebSocket service binds to `127.0.0.1`, checks browser origins, limits payloads, validates hook envelopes, and redacts before persistence or delivery.

This localhost MVP has no dashboard login and is not a security boundary against another process running as the same OS user. The hook token is redacted from captured tool results, but a hostile same-user process can access the session settings or database. Use a dedicated OS account or sandbox when that threat is in scope.

Vigil records an observed sequence. Timeline adjacency and event links do not claim causality.

## Validation

```bash
npm test
npm run typecheck
npm run build
```

The tests cover supported direct Codex reads, pass-through behavior, persistence redaction, hook authentication/size limits, fail-closed bridge behavior, scanner parsing/failure distinctions.

## Security Map (Giotto)

Open a session, expand **More details**, and choose **Visual explanation** for a live view of recorded actions, resource references, decisions and findings. Select a diagram element to inspect its supporting evidence. Finding details include **Explain visually**; maps support JSON/SVG exports. Attempts, returned tools and denials are distinct, and missing telemetry is explicit.

Giotto is vendored at reviewed commit `4c06069944fd0f515e4e7bf89b9cca8398cd7936`; install/build commands remain unchanged. Optional `--giotto-mcp` enables a restricted session-scoped stdio server for separate, inferred architecture diagrams. See [setup, tests and coverage gaps](docs/security-map.md).

## Session review and tools

The session view keeps the vulnerability breakdown and recommended next step beside a map of recorded actions and file references. **Map options → Agent architecture** opens separately inferred, agent-authored diagrams when configured. The two columns stack on small screens.

Below the map, **Choose your tools** includes Claude permissions and sandbox, Snyk Agent Scan, Lasso Claude Hooks, Docker Sandboxes, Superset, Conductor, and Langfuse, with links to their official setup guides. Choices are saved per session in this browser. In the fictional demo, switches simulate activation only. In live sessions, they select tools for setup; they do not install tools, modify permissions, or move a running agent into isolation. Existing scanner coverage is shown as results available, not as verified protection.
