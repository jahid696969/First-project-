# Iqra Tutor Network — Milestone 1

Dependency-free, local, rules-only conversation prototype. Node.js 22.8 or newer.
No installation, account, billing, API key, internet, database or server required.
There are no network calls or runtime file writes. Use synthetic data only.

## Run

```sh
npm test
npm run fixtures
npm start -- --message "মিরপুরে class 7 English version math টিউটর চাই, ৩ দিন, budget ৬ হাজার"
npm start
```

Interactive mode accepts one JSON object per line:

```json
{"conversationId":"synthetic-a","messageId":"1","text":"টিউটর চাই"}
{"conversationId":"synthetic-a","messageId":"2","text":"class 7 math"}
{"conversationId":"synthetic-a","messageId":"3","control":"takeover"}
{"conversationId":"synthetic-a","messageId":"4","text":"class 8"}
{"conversationId":"synthetic-a","messageId":"5","control":"resume"}
```

`/exit` ends the session. IDs are required and message IDs must be unique within
each conversation. Reused IDs are ignored even if text/control differs. Controls
are trusted local operator commands, never interpreted from customer text.
This is not an authenticated multi-user service. Resuming does not replay paused
messages or generate a reply. Send a new message explicitly after resuming.

## Output and state

Every result exposes `engineMode: rules`, intent, extracted and known fields,
missing fields, pending clarifications, next action, proposed reply and state.
Replies are local proposals only. No external messages or notifications are sent.
Readiness notifications are structured output for local inspection.

`processMessage` in `src/engine.js` accepts explicit previous state and returns a
copy. The CLI keeps separate states by conversation ID in memory. No state lives
in module globals. State records facts, source message IDs, operator mode, handled
IDs and ordered event traces. A state for another conversation is rejected.
All memory, duplicate protection and event history disappear on process exit.

## Supported rules

- Guardian/tutor enquiries, greeting, commission question, selected complaints.
- Bangla digits, class numbers/selected class words, known subject names.
- Distinct English Medium, English Version and Bangla Medium.
- Areas: Mirpur (optional section number), Dhanmondi, Uttara, Mohammadpur,
  Bashundhara. Unrecognized areas are not invented.
- Explicit gender preference, number of days (1–7), monthly salary/budget.
- Budget formats include `budget 5000`, `বাজেট ৬ হাজার`, `salary 5k`.
- Banglish examples include `tutor lagbe`, `class seven`, `3 din`, `budget 6 hajar`.
- Multiple subject names in one message are stored together. Explicit field
  updates such as `class 7` or `budget 6000` replace earlier facts.
- A bare class/days/budget number is accepted only as an answer to that question.
- Alternatives and negations require clarification. Clarify with a clean explicit
  value rather than a complicated sentence such as “not six but seven”.
- Complete guardian requirements produce a human-review summary, not a match.
- Commission: 50% of first-month salary, after the tutor receives that salary.
- Tutor registration goes to human review because no approved Form URL exists.
  Specific job interest requests Job ID; availability is never confirmed.

Guardian field order: class, subject, area, medium, tutor gender preference,
days/week, salary budget. One next question is selected, prioritizing ambiguity.
“No preference” is a valid gender answer. Unknown policies are not introduced.

## Safety and limitations

This is a bounded pattern matcher, not general Bangla understanding or a policy
reasoning model. It does not reliably understand arbitrary paraphrases, spelling
errors, all Banglish transliterations, subtle negation, mixed intents or indirect
corrections. Input phrasing outside supported patterns may need clarification or
human review. Tests demonstrate declared cases, not universal language accuracy.
Complaint and suspicious/unsupported request detection is also pattern-based;
it is not a complete security or sensitive-content classifier.

Paused/human-controlled sessions cannot resume through user text. Complaint,
human request, role change, new request, unknown Form link and selected unsupported
actions hand off. Independent requests should use separate conversation IDs;
automatic person identification or request splitting is not implemented.
Policy questions can be answered without replacing an established guardian role.
No tutor matching, contact disclosure, document processing, Sheets, LLM, channel
payloads, integrations or external storage are included.

Events intentionally contain metadata rather than full message text. They are
ephemeral diagnostics, not a durable audit log. Memory is unbounded for this small
local prototype; do not use it as a production service. Malformed inputs throw
validation errors; CLI reports them and continues. Never paste real personal data.

The synthetic fixture file contains expected outcomes; tests execute and verify
them in addition to targeted safety/state cases. Every future milestone needs
separate approval. Milestone 2/Gemini is not implemented.
