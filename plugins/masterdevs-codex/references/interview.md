# The interview protocol

Shared by `/masterdevs:feature` (as its first step) and `/masterdevs:refine` (standalone). Both load this
file rather than carrying their own copy — one protocol, one place to improve it.

**Why this exists.** Everything after the plan gate runs unattended; that is the point of the tool. The
user front-loads their attention here so they can go do other work while the agents build. A question
asked at minute 40 costs them a context switch. A wrong assumption costs them the whole run. So every
question that is answerable *now* must be asked *now*.

You are in the main session and can talk to the user. The workflow's agents cannot. Use that.

## When to skip

Skip when the ask is already self-contained — you can state the outcome, who it's for, what success
looks like, and what's out of scope in one sentence each, with **~95% confidence**. Mechanical work
("rename X to Y across the repo") and requests the user has already spec'd out qualify. Say you're
skipping and why, in one line, so they can stop you.

Otherwise, interview.

## How to interview

1. **Open with a hypothesis and a confidence number.**
   ```
   HYPOTHESIS: <your best one-sentence reading of what they want>
   CONFIDENCE: ~30% — missing: <what's unresolved>
   ```
   Below ~70%, say what's unresolved. This shows them exactly what the interview needs to close.

2. **Ask one question at a time, each carrying your guess.**
   ```
   Q: <one focused question>
   GUESS: <your hypothesis for the answer, and why>
   ```
   Wait for the answer before the next question. One at a time, not batched — later questions depend on
   earlier answers, and people correct a wrong guess far faster than they compose an answer from
   nothing. Attaching your guess is what makes that work; it also exposes your assumptions while they're
   still cheap to fix.

3. **Probe convention-signalling.** When you hear "it should be scalable", "the standard approach", "I
   should probably…" — that's deference to norms, not a requirement. Ask: *"If you didn't have to
   justify this to anyone, what would you actually want?"*

4. **Settle what proves it worked — and on what data.** Ask this one explicitly, every time. It is the
   single most common thing a finished run turns out not to have been able to answer for itself.
   ```
   Q: How will we know this actually worked — and what data can that be checked against?
   GUESS: <the check you'd run, and where the data for it lives>
   ```
   Real runs end with *"confirmed only against the local database, which holds a single deal"* and
   *"needs real customer deal data that does not exist locally."* By then it's too late to ask.

   If the proof needs a specific record, fixture, seeded database, or a live service, name it — and say
   whether the agents may reach it. **"Nothing local can prove this"** is a perfectly good answer; it
   just has to be known before the run goes dark rather than discovered at the end.

5. **Stop at ~95% confidence.** The test is checkable, not a vibe: **can you predict the user's reaction
   to the next three questions you would ask?** If yes, stop and restate. If no, ask the next one.

6. **Restate for line-by-line confirmation.**
   ```
   - Outcome:      <one line>
   - User:         <one line — who benefits>
   - Why now:      <one line — what changed>
   - Success:      <one line — how we'll know it worked>
   - Constraint:   <one line — the binding limit>
   - Out of scope: <one line — what we are explicitly NOT doing>
   - Verify on:    <one line — what proves it, and on what data>

   Yes / no / refine?
   ```
   **The "Out of scope" line is not optional.** Most late-breaking conflicts are silent disagreement
   about what wasn't being built — and in an unattended run those surface hours later, after everyone
   has moved on.

   **"Verify on" is not optional either.** "Success" is what good looks like; "Verify on" is what will
   actually be run, and against which data. They are different answers and the second one is the one
   that goes missing.

7. **Take explicit yes only.** "Whatever you think" → re-ask as a choice between two concrete options.
   "Sounds good" → ask what they'd refine. Silence → ask what's missing. Loop until they actually
   confirm.

The confirmed seven-field restate is the deliverable. It travels as `intent`.

## Rationalizations

| You'll be tempted to think | Reality |
|---|---|
| "The ask is clear enough" | If you can't write the outcome in one sentence right now, it isn't |
| "Asking wastes their time" | Four questions cost less than a two-hour run in the wrong direction |
| "I'll figure it out while building" | The agents that build can't ask. That's the whole constraint |
| "They said 'whatever you think'" | That's delegation, not a decision. Re-ask with two concrete options |
| "Attaching my guess leads them" | Leading is the point; being visibly willing to be wrong is the mitigation |
| "I'll just note it as an assumption" | Assumptions surface as conflicts hours later, when they're expensive |
| "The tests will prove it" | Tests prove the code does what the code says. Ask what data shows the *user's* problem is solved |
| "I'll find the right fixture while building" | The agents that build can't ask which deal to use, and will substitute one |
