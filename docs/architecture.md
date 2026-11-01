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
- Only `modules/mobile` may call anything that changes the collection, and only after the user
  switched it on.
- Only `host/` may import `aqt`.

Two further rules protect Anki itself:

- Hook handlers use `guarded`, so a Statly failure never reaches Anki.
- Never recompute statistics during reviews. Queries share one worker with answering cards:
  an answer takes about 4 ms normally and about 260 ms next to constant queries.

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
call. A test refuses tools that reach beyond statistics, the dashboard and custom widgets.

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

## Phone card

iOS has no add-ons, so `modules/mobile` keeps a single card in its own deck, and Anki's normal sync
carries it to phones. This is the only code in Statly that writes to the collection, and it runs
only after the user switched it on and a backup was made. `writer.py` follows rules that real
collections taught us:

- Writes join the user's last action with `merge_undo_entries`. A plain write would wipe undo.
- With a redo waiting, a write is postponed, because it would destroy that redo.
- Note type fields never change and the note type is never removed. Either would force a full sync.
- Data is base64 in a field, because Anki rewrites parts of plain text. The card script must not
  contain double braces or sound tags. `card.py` refuses such a build.
- Before a session's first sync nothing is written, so a stale card cannot replace a newer one.
- Statistics skip this card through `CollectionReader.excluded_cards`.

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
