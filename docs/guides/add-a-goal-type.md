# Add a kind of study goal

Statly has one kind of study goal today, the exam goal. This guide walks through adding another,
for example "Review every due card each day" or "Learn 20 new cards a day". The parts are already
split so that a new kind brings its own rules and reuses everything around them: the day book,
streaks, the ring and timeline, the phone card, syncing and the assistant.

## 1. The contract

Everything starts in `packages/contract/src/goals.ts`:

- Add the kind to `goalKinds`.
- Add its settings as a schema next to `examConfig` and to the `goalConfig` union. Keep a field
  `kind` with the literal name, because both sides tell kinds apart by it.
- Its status joins `goalStatus`. Reuse the fields of `examStatus` where they mean the same, such as
  `target`, `done`, `tone`, `streak`, `history`, `plan` and `warnings`, so the ring, the timeline,
  the dashboard widget and the phone card work without changes.

Run `pnpm contract`. It regenerates `addon/src/statly/contract/`, and CI fails if that is out of
date.

## 2. The rules in Python

Each kind lives in a package of its own under `addon/src/statly/modules/goals/`, like `exam/`:

- `inputs.py` is the only place with SQL for that kind. Every statement is a plain `SELECT` through
  `CollectionReader`, cards count for their home deck, and the phone card never counts.
- `plan.py` is pure: settings, counts and the day's goal as it was fixed go in, numbers come out. No
  Anki, no clock, no files, so every rule can be tested with exact numbers in a test like
  `addon/tests/test_goal_plans.py`. Give it an `ALGORITHM` name with a version, such as
  `"daily-reviews/1"`. Every day in the day book stores it, so a better version later never changes
  the meaning of old days.

Shared rules are already there: `days.py` for study days and days off, `allocate.py` for splitting
a number exactly over decks, and `streaks.py` for streaks worked out from the days.

`service.py` puts a goal together. Today `status`, `preview`, `keep` and `_checked` call the exam
package directly. A second kind adds the branch on `config["kind"]` there and nowhere else: the day
book (`ledger.py`), the live count while studying (`live.py`), the phone card (`phone.py`), syncing
(`sync.py`) and the assistant's overview read what `status` returns and need no change, as long as
the status keeps the shared fields.

Estimates such as study time come from `modules/estimates` and are shared by every kind.

## 3. The app

In `apps/web/src/features/goals/`:

- `kinds.tsx` lists every kind with its icon and its first settings. TypeScript reports a kind
  from the contract that is missing there, so it cannot be forgotten.
- The gallery offers every listed kind by itself.
- The setup page (`GoalSetup.tsx`) shows the fields of a kind. Put the new fields in a component of
  their own and choose it by `config.kind`.
- Texts go under `goals.kinds.<kind>` in `packages/i18n/locales/en.json` and `de.json`, with the same
  keys in both.
- `bridge/mockGoals.ts` answers for `pnpm dev` and the browser tests. Teach it the new kind too.

## 4. Tests

- Pure rules with exact numbers, like `test_goal_plans.py`.
- The kind against real collections, like `test_goals.py`, including deleted decks and cards,
  filtered decks, the phone card and running in the middle of a review session.
- A browser test that sets the goal up and puts it on the dashboard, like `apps/web/e2e/goals.spec.ts`.
- `scripts/bench_statistics.py` keeps the cost of a goal within its budget on a collection with a
  million reviews.

## What a kind must never do

A goal only reads Anki. If a kind needs to change something in Anki, as the exam goal raises
today's limit of new cards, that change is a file in `modules/changes` with a permission of its
own, and it goes through the gate described in `docs/adr/0003-permissions-and-changes.md`. The
assistant can suggest a goal but never save one, see `docs/adr/0002-how-the-assistant-stays-safe.md`.
