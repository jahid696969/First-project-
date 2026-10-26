# Iqra Tutor Network — local reply prototype

Node.js 22.8+, ES modules, no third-party dependencies. No npm install required.
Milestone 2 adds optional Gemini REST transport; live API evaluation has NOT yet been performed. The owner selected
VS Code on their own computer for the controlled synthetic evaluation. No database, web server, channel integration or billing setup.
Use synthetic or properly de-identified data only. Never use customer data or IDs.

## Local use (no network, no key)

```sh
npm test
npm run fixtures
npm start
npm start -- --message "টিউটর চাই"
npm start -- --debug
```

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm`.
In normal interactive mode type plain text, one message per line:

```text
টিউটর চাই
class 7 math
Mirpur
English Version
যেকোনো টিউটর চলবে
3 দিন
budget 6000
```

Output shows `তুমি:`, `সিস্টেম:` and `[rules]` or `[llm]`/fallback reason.
Rules mode still has a limited vocabulary; plain text is a nicer interface, not
additional language intelligence. `--debug` shows structured JSON instead.
`--fixtures` always prints JSON and refuses Gemini mode.

Operator commands: `/pause`, `/takeover`, `/resume`, `/new synthetic-b`, `/exit`.
`/new ID` switches conversation; using an existing ID returns to that session.
Paused messages are not replayed on resume. Commands are trusted local operator
controls, not commands parsed from customer text. This is not an authenticated app.

JSON-line input is still supported for explicit IDs and duplicate testing:

```json
{"conversationId":"demo-a","messageId":"1","text":"টিউটর চাই"}
{"conversationId":"demo-a","messageId":"2","control":"pause"}
{"conversationId":"demo-a","messageId":"3","control":"resume"}
```

Reused message IDs do not process again, even if text or controls differ. Use a
fresh message ID for each new action. Only one-shot `--message` starts a fresh
session each run. All state, history, counters and dedup records disappear on exit.

## Architecture

- `src/engine.js`: synchronous rules baseline and shared state-transition logic;
  accepts validated provider analysis without replacing application safeguards.
- `src/rules.js`: bounded Bangla/Banglish/English patterns.
- `src/state.js`: isolated state, source IDs, events and operator mode validation.
- `src/policies.js`: owner-approved questions and business policies.
- `src/assistant.js`: instance-owned sessions, per-conversation sequential work,
  async timeout, fallback, bounded transcript and stale-result checks.
- `src/provider-output.js`: small JSON schema and strict local value validation.
- `src/providers/gemini.js`: disabled-by-default, injected-fetch REST transport.
- `src/cli.js`: terminal only; no runtime file writes.

Guardians: class, subject, area, medium, tutor gender preference, days/week, salary.
English Medium, English Version and Bangla Medium are distinct. Questions are
application-selected one at a time. Mixed commission/guardian messages can update
facts and answer policy. Commission is 50% of first-month salary after receipt.
No approved Google Form URL exists; registration hands off rather than inventing a
link. Job ID is collected where recognized, never verified as an active tuition.
No tutor matching, outreach, contact disclosure or document processing exists.

Rules support class 1–12, days 1–7, selected subject names, Mirpur (optional section),
Dhanmondi, Uttara, Mohammadpur, Bashundhara; budget units k/হাজার/hajar/hazar.
Ambiguous negation/alternatives need clarification. Unsupported classes/requests,
unknown policies, role changes and sensitive cases require clarification/review.

## Optional Gemini transport — pending separate live-test approval

Default commands NEVER load a key or call Gemini. Live mode is authorized only
for the controlled synthetic evaluation on the owner's computer, after confirming
the same project remains Free Tier without linked billing. Do not paste a key in
chat, source, prompts or Git. No `.env` file is created or required.
After approval, the operator may supply `GEMINI_API_KEY` through a secure local
environment variable. Never put it in source, CLI arguments, Git or chat.
The live gate is explicit: both `--gemini` and `--allow-api-tests` are required.
The latter flag is a local consent guard, not proof of approval, Free Tier or
privacy suitability. Do not use it before approval.

The only allowed model is `gemini-3.8-flash`; endpoint is fixed to Google
`v1beta/models/gemini-3.8-flash:generateContent`. Key travels in an HTTPS header,
not a URL. Uses systemInstruction, contents and generationConfig with JSON schema,
no tools, search, file uploads, caching workflow or paid-model fallback.
No SDK dependency; official SDK alternative is @google/genai, not installed.

Runtime model availability, project quota and successful authentication are NOT
verified. Owner reports Free Tier and no billing linkage; quota labels are
RPM 60 / TPM 100,000 / RPD 100. Application cannot independently attest billing.
Consumer Gemini subscription is not Developer API credits. Free-tier content may
be used for product improvement: only controlled synthetic evaluation on the owner's computer is authorized; no
call has been performed by Codex. All model prose remains a local unverified draft.

Transport limits: one request per eligible message, zero automatic retries,
20-second assistant timeout, 20 calls per provider instance/session by default.
Local counter is not a persistent daily quota meter and resets on restart.
401/403/404/429 disables that provider instance until deliberately recreated;
other errors fall back without retrying that message. No billing/account APIs.
Missing key, invalid schema, network failures and truncated output use rules where
safe; rules uncertainty clarifies/hands off. Safety refusal hands off directly.
Logs use sanitized status codes, never keys or raw remote error bodies.

## Reliability and validation limits

The assistant serializes normal input per conversation. Its engine-level controls
apply immediately and invalidate pending results even after resume. The current
CLI awaits each reply before reading the next line: /takeover and /pause typed
during a pending request will be delayed. Use Ctrl+C to stop the local process
immediately; restarting loses state. Immediate CLI takeover is not fixed here. Abort is requested on timeout;
a late result cannot mutate state. Provider-reported needsHuman cannot override a
pause or hard handoff. A pending request invalidated by takeover is consumed once
without applying its facts/reply. Nothing is sent externally.

History is at most 12 turns and 8,000 characters; older history is dropped while
known facts remain. Drafts are labelled assistant_draft, not delivered messages.
Events/IDs remain in memory without production-sized retention management.

Model fields require exact current-message evidence, numeric bounds and allowed
enums; clear evidence/value contradictions are rejected. Evidence spans and JSON
schemas cannot prove semantic truth. Natural-language hallucinations or sophisticated
prompt injection cannot be fully detected with these checks. Unsupported claims
are screened conservatively. Policies, question selection, readiness and handoff
remain application-controlled. Model reply prose is used only for a validated
non-policy clarification without unresolved field ambiguities; other replies use
application templates. Empty/malformed/refused output is never blindly displayed.
This is a local evaluation tool, not production security or autonomous messaging.

## Tests and evaluation status

`npm test` runs original regression tests, mock-provider fault/state tests and
mock REST request/response tests. Default network use is forbidden by a test guard;
all transport tests inject mocks with synthetic keys. CLI tests call the CLI in
process because this managed sandbox blocks child-process spawning.

`fixtures/exceptional-conversations.json` contains synthetic expected outcomes.
Mocks are supplied those outcomes to test plumbing: passing them does NOT measure
Gemini Bangla accuracy. No live LLM results, quality percentages, real quota usage
or production latency have been measured. `latencyMs` measures a provider attempt;
mock timings are not live estimates. Later approved evaluation should compare
rules vs actual model: intent/field correctness, correction accuracy, unsupported
claims, handoffs/fallbacks, repeated questions, token use and latency. Run small
batches within verified quota; preserve held-out examples. Never claim every
exceptional case will work.

Official references (review current availability again before live testing):
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/gemini-api/docs/rate-limits

Changes are local only; this milestone does not automatically commit or push to
GitHub. No secret or live data belongs in this repository.


## Controlled evaluation in VS Code (Windows PowerShell)

First use the latest Milestone 2 files plus these fixes. The old Milestone 1-only
GitHub checkout does not contain the Gemini adapter. Open the project folder in
VS Code (File > Open Folder), then Terminal > New Terminal, choosing PowerShell.
Check `node --version` (22.8+) and run `npm.cmd test`. No npm install is required.

Confirm the existing AI Studio project still shows Free Tier, no linked billing,
and an active quota for gemini-3.8-flash. The reported limits are not independently
verified. Do not link billing, upgrade or switch model to bypass failures.

Enter an existing approved project's key through a hidden prompt in this terminal:

```powershell
$iqraSecret = Read-Host "Gemini API key (hidden)" -AsSecureString
$env:GEMINI_API_KEY = [System.Net.NetworkCredential]::new("", $iqraSecret).Password
$iqraSecret.Dispose()
Remove-Variable iqraSecret
node -e "console.log(Boolean(process.env.GEMINI_API_KEY))"
```

The last command prints only true/false, never the key. This sets a process/session
environment variable; no .env file or permanent profile change is needed. VS Code
extensions and other processes launched from this terminal may inherit the key;
use a trusted local workspace. A local variable is not available in Codex's remote
environment. Do not send it to Codex.

For Bash instead, use `read -r -s -p 'Gemini API key: ' GEMINI_API_KEY`, then
`export GEMINI_API_KEY` and `printf '\n'`. Do not put the literal key in commands.

Start with ONE synthetic request (only after the checks above):

```powershell
npm.cmd start -- --gemini --allow-api-tests --debug --message "আমার বাচ্চা সপ্তম শ্রেণিতে, অঙ্কে সাহায্য প্রয়োজন"
```

Expected facts: guardian intent, class 7, Math; normally the next question asks
area. Verify `engineMode: llm` AND `providerStatus: validated`, not just a plausible
rules reply. Actual Gemini wording, success and latency are unverified. This may
consume one request even when the application rejects the model response.

The debug result contains `latencyMs` and, if the provider returns valid counters,
`tokenUsage` with promptTokenCount, candidatesTokenCount, totalTokenCount,
thoughtsTokenCount and cachedContentTokenCount. Unknown/invalid counters are
omitted, not treated as zero. Do not add these counters blindly: totals may already
include thinking/cached tokens. Counts are reported usage, not a price estimate.
Usage can be present even when the generated output is rejected. Usage is not
stored in conversation state. No headers, keys or raw error bodies are included.

If status is missing_key, auth_error, model_unavailable, quota_exhausted, timeout,
provider_error, invalid_output or incomplete_output: stop; do not repeatedly rerun
or change billing/model. Share only sanitized status, synthetic result, usage and
latency. Stop on any unsupported claim/safety failure. Provider instance quotas
reset on restart, so avoid restarting to bypass limits. Review the first result
before a sequential batch of at most 10–15 synthetic cases. No automatic retries.

Once first-case success is reviewed, readable interaction uses:

```powershell
npm.cmd start -- --gemini --allow-api-tests
```

At the end, remove the variable from this terminal:

```powershell
Remove-Item Env:GEMINI_API_KEY
```

For Bash use `unset GEMINI_API_KEY`. Never paste the key or a screenshot of it into
chat. No live tests have been run in this managed environment, and no file changes
have been committed or pushed as part of this evaluation preparation.
