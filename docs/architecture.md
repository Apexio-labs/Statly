# Architecture

Statly is an Anki add-on. A React app draws the interface, Python talks to Anki.

```
apps/web (React)  <-- bridge -->  addon/src/statly (Python)  -->  Anki
```

## Layout

| Path                        | Purpose                                            |
| --------------------------- | -------------------------------------------------- |
| `addon/src/statly/core`     | Logic that runs without Anki's interface           |
| `addon/src/statly/host`     | The only code that may import `aqt`                |
| `addon/src/statly/modules`  | Features, each registered in `modules/__init__.py` |
| `addon/src/statly/contract` | Generated from `packages/contract`. Do not edit    |
| `apps/web`                  | The interface                                      |
| `packages/contract`         | Every call and event between React and Python      |
| `packages/charts`           | ECharts wrapper and chart options                  |
| `packages/card-viewer`      | Draws the phone card, also in the desktop preview  |
| `packages/i18n`             | Translations                                       |
| `packages/mcp-bridge`       | Connects external AI apps to Statly                |
| `packages/ui`               | Theme tokens and brand assets                      |
| `packages/widget-runtime`   | Styles shared by everything that draws a widget    |

## How a call travels

1. React calls `bridge.call("system.ping", {...})`.
2. `Router.handle` checks the parameters against the contract.
3. The handler runs. Handlers that read the collection run on Anki's background worker.
4. Python answers through `window.__statlyBridge.resolve`. Every call gets exactly one answer,
   and React gives up after 30 seconds.

To add a call, define it in `packages/contract/src/rpc.ts`, run `pnpm contract`, and register a
handler in a module. A test fails if a contract method has no handler.

## Safety rules

Protecting the user's cards comes first. These rules are enforced by
`addon/tests/test_architecture.py`:

- Only `core/reader.py` touches the database, and it accepts nothing but a plain `SELECT`.
  `WITH` queries, comments and multiple statements are rejected because Anki treats them as
  writes and clears the user's undo history.
- Only `modules/changes` may call anything that changes the collection, and only its gate hands
  work to Anki's worker, after checking the permission. See "Permissions and changes" below.
- Only `host/` may import `aqt`.
- Only `core/localdb.py` may use `sqlite3`, and only on `statly.db` in `statly_data`.

Further rules protect Anki itself:

- Hook handlers use `guarded`, so a Statly failure never reaches Anki. Filters use
  `guarded_filter`, which hands Anki's value back unchanged even when Statly fails.
- Never start a query while a card is being answered. Queries share one worker with answering
  cards: an answer takes about 4 ms normally and about 260 ms next to constant queries. The
  window counts again after each answer only once the next card is on screen, and at most one
  round of queries waits at a time (`useStatisticsUpdates`).
- Nothing listens for `reviewer_did_answer_card`: with a listener there, Anki loads every
  answered card again. See "Reviewer" below.

## Window

The window holds up to three blocks in front of a black background. The AI panel is the optional
third block on the right, and it can be dragged between 300 and 640 pixels. The left block is the
main menu,
which can be dragged between 64 and 260 pixels. It snaps to either edge within 14 pixels and shows
only icons below 194. Settings and the dashboard editor add a side panel to this block through
`useRail`, and the main menu then shrinks to icons.

## Devices

There is one dashboard. The desktop layout is the source, and tablets and phones are worked out
from it by `modules/dashboard/devices.py`. Every device uses the same cell size and only the number
of columns differs: 12, 8 and 4. A widget's limits and its arrangements for certain sizes therefore
mean the same everywhere, so one widget works on all devices.

A device stays automatic until someone arranges it in the dashboard's edit mode. From then on it
keeps its layout, and `known` tells new desktop widgets from ones removed on purpose.

The card holds both layouts and picks one by its width, so phones and tablets, on AnkiMobile and
AnkiDroid alike, need nothing else. Python works out every value in advance, because a card cannot
ask for anything. `packages/card-viewer` draws the card and also the preview in the editor, so the
two cannot drift apart. Pictures of custom widgets are shrunk to fit, up to a budget. Videos stay on
the desktop.

## Assistant

`modules/ai` holds the chat and the local API for external apps. Both use one `ToolBox`, which is
generated from `packages/contract/src/aiTools.ts`. The rules that keep this safe are in
`docs/adr/0002-how-the-assistant-stays-safe.md`.

To add a tool, add it to `aiTools.ts`, run `pnpm contract`, and map reading tools to an existing
call. A test refuses tools that reach beyond statistics, the dashboard, custom widgets and the goal
overview, and `ToolBox` refuses every call that changes Anki even if a tool named one. Goals are
read with `get_goals` and suggested with `propose_goal`, which only fills in the setup page.

## Editors

Whoever leaves an editor with unsaved work is asked first, through `useUnsavedGuard`, whether by
the menu, with Cancel or by closing the window. Anki closing the collection does not ask, because a
sync must not wait for a dialog.

## Dashboard

The grid in `features/dashboard/grid` is a CSS grid with 12 columns. Widgets keep exactly the cell
they were dropped on, including any gaps. `engine.ts` holds the rules as plain functions: a widget
in the way moves to the nearest free spot, and all others stay put.

`packages/contract/src/dashboard.ts` defines the built-in widgets, their allowed sizes and the
default layout. Python and React both read these values. Layouts and settings are JSON files in
`<profile>/statly_data`, so they are not part of the collection and do not sync.
`core/prototype.py` takes over data from Statly's first version once and keeps the original as
`settings.prototype.json`.

Add a widget in three places: its size in `dashboard.ts`, its component in
`apps/web/src/features/dashboard/widgets.tsx`, and its texts in `packages/i18n/locales`. TypeScript
reports a missing component, and a test reports a missing translation.

## Custom widgets

A custom widget is data: a background and a list of elements, defined in
`packages/contract/src/widget.ts`. It never contains HTML or code, so widgets from strangers or
from an AI are safe to show. Positions are percentages and text sizes use container units, so a
widget keeps its proportions at any grid size.

Definitions live in `<profile>/statly_data/custom_widgets`. Media files sit next to them, named
after their own hash, and are checked by their content, not their file name. `.statlywidget` files
are ZIP packages and are treated as untrusted in `modules/widgets/sharing.py`.

To add an element, define it in `widget.ts`, draw it in
`apps/web/src/features/widgets/ElementView.tsx`, give it fields in `editor/Inspector.tsx`, and
offer it in `editor/Palette.tsx` and `editor/templates.ts`.

## Permissions and changes

Statly does nothing new until the person allows it, and the question comes from Python in a popup
of its own, never from a button in the page. The popup (`host/prompt.py`, drawn by
`apps/web/src/prompt`) is a second web view laid over the app in the same window: it looks like the
app, but the app's page cannot reach into it. Uninstalling and closing with unsaved work ask there
too. `packages/contract/src/permissions.ts` lists every
permission, `core/permissions.py` keeps the answers per profile and computer, and
`modules/permissions` asks and takes back. Settings → Privacy & Security shows all of them and every
change Statly made in Anki. The reasons are in [ADR 3](adr/0003-permissions-and-changes.md).

`modules/changes` is the one door for writes. Each file there is one kind of change and names its
permission: `phone_card.py` for the phone card, `deck_limits.py` for today's limit of new cards. A
single change becomes a named step in Anki's undo history and an entry in Statly's log. The
assistant's changes ask every time, and changes Statly makes on its own wait while someone reviews
or a redo is waiting. A goal raises today's limits with `goals.raiseLimit`, which takes only the
goal's id; `GoalService.limits_needed` works out the decks and numbers, and with "Always allow"
the goals module does the same by itself on the studied deck's overview, at most three times a
goal and day (`MAX_RAISES_A_DAY`).
`ChangeNotice` in the app shows each change with an undo button.

To add a kind of change, add its permission to `permissions.ts`, write a file in `modules/changes`
with `PERMISSION` and the methods of `Change`, list it in `_rebuilt` for undo, and add its texts to
`modules/permissions/labels.py` and the web app's `privacy.*` keys.

## Goals

A study goal is the main thing, and a dashboard widget is a window onto it: `goal:<id>:ring` or
`goal:<id>:timeline`, so one goal can be on the dashboard in both views. `modules/goals` registers
`goal:` as a widget source, so a deleted goal leaves the dashboard by itself. The shapes live in
`packages/contract/src/goals.ts`.

The code is in four layers, so one can change without the others:

- **Collect** (`exam/inputs.py`): the only SQL of a goal. It reads Anki's history only from the
  first day that is not settled yet, so a goal costs the same on any collection: 85 ms over 100,000
  cards and a million reviews without the cache, 0.2 ms with it.
- **Plan** (`exam/plan.py`): pure rules. What is still open is spread over the study days left,
  every morning anew, so the plan corrects itself. A card counts once it went through its learning
  steps. Each day's goal is fixed at the first count of that day. Cards added after that wait for
  tomorrow, deleted ones lower the goal at once.
- **Shared rules** (`days.py`, `allocate.py`, `streaks.py`): study days, exact shares for decks
  and subdecks, and streaks that are worked out from the days instead of being counted up.
- **Put together** (`service.py`, `store.py`, `ledger.py`): one file per goal and a day book per
  goal. A day's goal stays as it was fixed, what was done is read again for a week because phone
  reviews arrive with the sync, and days on which Anki did not run are worked out from its history.
  Each entry names the algorithm that made it, so a new one never changes old days.

A goal either has every card learned once (`learned`) or also seen again once before the deadline
(`reviewed`). A `reviewed` goal learns new cards until the deadline minus the days a card needs to
come back, measured from the person's own first intervals (`estimates/returns.py`, with the
deck's graduating interval as fallback). When that day has passed, it plans like a `learned` goal
and says so. A card counts as seen again with any review or relearning answer; learned cards that
Anki would show only after the deadline are named, for cards in filtered decks by their original
due day. This is the goal's most expensive query: 250 ms over a million reviews, within its
400 ms budget. Coming days expect the reviews already due then plus the planned cards coming back,
from the person's echo: how many reviews a learned card brought on each day after learning.

Statly counts goals whenever Anki runs, also with its window closed: when the deck list shows,
on a deck's overview right before studying, after studying and after a sync, never during it.
While someone studies, `live.py` counts along in memory from the numbers of that last count and
tells Anki's reviewer the moment the day's goal is met (the setting `goalToast`).

Goals reach the person's other computers through Anki's normal sync, with the permission
`goals.sync`, which the first goal asks about once. Each computer writes one entry of its own in
the collection's settings, `statly.goals.<device>`, with a random name for the computer
(`SyncStore`), right before a sync and only when it changed (`modules/changes/goal_sync.py`). After
a sync, `sync.py` brings the entries of all computers together: the newest change of a goal wins,
deleting always wins, and for a day the goal fixed first on any computer applies. An entry holds
the goals, the ones deleted or archived, the day's goals of the last week and the best streaks,
and stays below 8 KB; what was learned every computer reads from Anki's own history. Anki passes
no removed setting on, so switching off writes an "off" entry. `addon/tests/test_goal_sync.py`
syncs two fresh collections through Anki's own sync server on the test machine: a goal arrives
with a normal sync, a deletion goes back, and the undo history and the schema stay as they were.

## Reviewer

`modules/review` is the only part of Statly that listens to Anki's reviewer. It keeps each look at
a card as an `Attempt` in memory: card, home deck, its state before, when it was shown, how long it
took, how much of that Anki was in the background, and the button. It listens to four moments:
the question shown, the answer about to be given (a filter that never changes it), an undo whose
step Anki names "Answer Card" (compared with Anki's own label, so it works in every language), and
the end of studying. An answer is told to other modules only once the next card is on screen
(`Host.later`), so whatever they do cannot delay it. Undo marks the newest answer of the card it
brings back. `modules/statistics` tells the window after each answer and undo, so the widgets
follow along while the person studies; an answer given while that round still runs waits behind
at most one query.

The stopwatch (`modules/timing`) and the goals listen to these attempts. The stopwatch always
runs, without a permission: it only measures on this computer, never changes Anki, never sends
anything and never stores what a card says. The stopwatch keeps them in Statly's own SQLite file,
`statly_data/statly.db`. `modules/storage` opens that file for every part that keeps rows there
and closes it with the profile, after each part wrote what it held (`LocalDatabase.before_close`).
`core/localdb.py` writes on a thread of its own every few seconds and when studying ends. Each part
keeps its tables there under a name with numbered steps, which run once in order. Undone looks are
kept too, so the time at a card adds up every look: 40 seconds, undo, then 1 second is 41 seconds,
where Anki keeps 1. The file stays when a goal is deleted, because the study time model learns
from it.

## Making cards

Anki keeps no record of how long writing a note took, so `modules/creation` measures it, under the
same rules as the review stopwatch: always on, only on this computer, ids and times only.
`host/adding.py` is the only part that watches Anki's Add window. It reports `AddingEvent`s:
opened, closed, where the person works (in the Add window or a window it opened, in another program,
or in another Anki window), a pause in typing or a move to another field, and an added note
with its first card's deck and its number of cards. Anki's newer, experimental editor reports no
typing and fires no "note added" hook; there a note counts once the editor loads the next empty
note, and only when exactly one new note appeared, so an import never counts.

`clock.py` (plain Python) turns these into seconds per note. Time counts while the window is in
front and while another program is, because cards are often made while looking things up there.
Time in another Anki window does not count, so studying never counts twice. Between two signs of
work at most 5 minutes count (`PAUSE_LIMIT`), and one note at most 20 minutes (`NOTE_LIMIT`). The
newer editor, which reports no typing, gets only the note limit while it is in front. Each note becomes one row of
the `creations` table. `stats.py` serves `statistics.creation`: only notes that still exist count,
with their cards as they are now and the current deck of their first card, so an undone add or a
deleted note drops out by itself. The usual pace is the time per card over all decks and all
measured notes. 20,000 measured notes take about 100 ms on the benchmark collection.

## Estimates

`modules/estimates` holds estimates other parts share; the first is study time. Like goals, it is
built in steps that can change one at a time:

- **Read** (`history.py`): the only SQL. Answers of the last 90 days, at most the newest 25,000,
  because older answers count little and this keeps a cold estimate near 60 ms on a million
  reviews.
- **Interpret** (`sessions.py`, pure): Anki stops its clock at the deck's limit and forgets undone
  looks. The gap to the previous answer bounds a cut-off time, ends a session when it is a break,
  and, when clearly longer than usual but no break, most likely held an undo or an edit, so the
  extra time goes to the card. Stopwatch measurements replace all of this where they exist.
- **Fit** (`censored.py`, pure): a log-normal per options preset and card state, fitted with
  expectation maximisation, so cut-off times count as "at least" or "between" instead of being
  taken at face value. Small presets lean on the person's overall pace, recent days weigh more.
- **Forecast** (`study_time.py`, pure): time per answer, the seconds between cards, the answers a
  new card needs until it is learned and how often a review needs relearning. The last 30 days
  calibrate it: the middle of how far forecasts were off is applied, and the range is where most
  days fell. Every estimate names its model, `study-time/1`.

`scripts/backtest_goals.py` forecasts past days from the days before them on a copy of a
collection and reports the error and how often the range held. Run it with the old and the new
model before replacing one.

## Phone card

iOS has no add-ons, so `modules/mobile` keeps a single card in its own deck, and Anki's normal sync
carries it to phones. It is written only after the person allowed `mobile.card` in Statly's dialog
and a backup was made, through `modules/changes/phone_card.py`, which follows rules that real
collections taught us:

- Writes join the user's last action with `merge_undo_entries`. A plain write would wipe undo.
- With a redo waiting, a write is postponed, because it would destroy that redo.
- Note type fields never change and the note type is never removed. Either would force a full sync.
- Data is base64 in a field, because Anki rewrites parts of plain text. The card script must not
  contain double braces or sound tags. `card.py` refuses such a build.
- Before a session's first sync nothing is written, so a stale card cannot replace a newer one.
- Statistics skip this card through `CollectionReader.excluded_cards`.

A study goal on the dashboard reaches the card too. `modules/goals/phone.py` turns it into a
custom block built from the card's own elements, a ring or bar and lines of text, so the phone
needs nothing new to show it. The card is no live count, so the block says when it was made
("Stand: 5. Nov., 7:12"). That time goes in only when the card is written (`filled`), so an
unchanged goal leaves the card's content unchanged and causes no extra write or sync.

People can edit the card on a phone like any other, so a sync may bring a broken one back.
`needs_repair` checks it on every look at the deck list and right after a sync, and the next write
restores exactly this card. A note moved to a note type that is not Statly's is replaced, and that
note type stays untouched. A note type someone reshaped stays behind unused, because changing it back
would force a full sync. `_is_ours` decides what may be overwritten, so a look-alike of the user's
never passes.

The card has `class="tappable"` on its root, so AnkiMobile does not reveal the answer on a tap, and
`touch-action: manipulation`, so fast taps do not zoom.

`packages/card-viewer` builds `viewer.js`, the script inside the card. It has no dependencies, and
it imports numbers from `@statly/contract/limits` because the package's main entry would bring zod
into every card. A test keeps the script small.

## Toolbar and menu

Statly takes the place of Anki's Stats link in the top toolbar, and Anki's statistics stay reachable
from Statly's sidebar. `host/menu.py` adds a Statly menu to the menu bar.

## Statistics

`modules/statistics` holds one function per statistic. Each returns plain data, and the web app
does all wording and formatting.

- Days are Anki days. They start at the user's rollover hour, computed from `sched.day_cutoff`.
- A review is a card moved to a later day: an answer with `ivl > 0` (steps within the day are
  negative, previews 0). Each card counts once a day, however often it came up. A rating is every
  press of a button, what Anki itself calls reviews. Charts take `measure` to count ratings
  instead, which the `rating-*` widgets use. Study goals follow the same rule for their reviews.
  The rule is "moved on at least once that day", not "moved on by the day's last answer": the
  second costs about six times as much over a million answers and only differs when a card comes
  back the same day after it moved on, for example through Review ahead.
- Reviews of deleted cards stay in the history. Cards in filtered decks count for their home deck.
  `revlog` does not record the deck, so history follows a card's current deck.
- Queries run one at a time, because answering a card waits behind every queued query.
- Results are cached by `(call, params, col.mod, newest review, Anki day)` and cleared after a sync.

`scripts/bench_statistics.py` checks the budget on one million reviews: 1 s for the whole
dashboard without cache, 300 ms with it.

The widgets named `anki-*` rebuild Anki's statistics page. They use the backend call behind that page
through `CollectionReader.graphs`, which is the only backend call Statly reads through. It keeps the
numbers equal to Anki's, and FSRS values such as retrievability exist nowhere else. One call answers
every section, so it is cached once per deck. `modules/statistics/anki_stats.py` turns it into ranges,
bars and summary lines. The phone card uses the same code, so both show the same.

## Decisions

Lasting decisions are recorded in [docs/adr](adr).
