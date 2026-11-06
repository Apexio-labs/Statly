# 3. Permissions, and one door for changes to Anki

## Context

Statly started out reading only, with one exception: the phone card, written by `modules/mobile`.
New features need more. A study goal may have to raise a deck's limit for new cards, goals should
reach other computers through AnkiWeb, and Statly will measure review times on its own. Each of
these touches the person's data or collection, so each needs their consent.

A click inside the web page is no consent. Anything that runs in that page, a bug, an injected
script, an answer from a model, could click the same button.

## Decision

Statly follows the approach of Apple's platforms: nothing new happens until the person allows it,
the question is asked by the system and not by the page, and everything allowed can be taken back
in one place.

**The list.** `packages/contract/src/permissions.ts` names every permission and how it can be given:
"Only this time" covers exactly one action, or one chat for the assistant, and "Always allow" lasts
until it is taken back. A module offers a permission with `PermissionService.offer`, and only offered
or granted permissions appear in Settings → Privacy & Security.

**Asking.** `PermissionService.ask` opens Statly's own popup (`host/prompt.py`). It lies over the
app in the same window and uses the app's styles, so it looks like any other Statly dialog. But it
is a web view of its own: Python fills it, Python alone reads its answers, and each question carries
a token of its own. The app's page sits below it and cannot reach into it, so neither a bug in the
page nor an answer from a model can press its buttons. Its words come from Python and go in as
plain text, and the first button is the safe one, which has the focus and which Escape picks. Nothing waits for the answer: the popup
opens and the answer arrives later through a callback. A question usually starts inside a call
from the app's page, and while Python handles such a call, Anki's web engine runs no page scripts,
the popup's own included, so a dialog that waits there never appears. One popup shows at a time. After a "no" to a question the assistant brought up, the same question stays
quiet for 30 seconds, so a model cannot pester someone into saying yes. Questions the person starts
with a click of their own, such as a switch in the settings, come without this pause. Only while
Statly's window is closed does Anki's own dialog stand in.

The web page can only ask for the popup with `permissions.request`. Taking a permission back works
from anywhere, because it is the safe direction, and first cleans up what the permission allowed,
such as removing the phone card.

**One exception: a single chat.** When the assistant wants deck names or card text, the chat asks
with buttons of its own. They can only allow this one chat, and only reading, which ends with the
chat. A click in the page is accepted here on purpose, because asking in a popup for every chat
would be tiresome and the reach is small. "Always allow" in the chat does not allow anything: it
opens Settings → AI and frames the switch, so the person learns where it lives and switches it on
there, through the popup. A waiting chat then goes on by itself.

**Keeping.** `core/permissions.py` stores grants in `statly_data/permissions.json`, per profile and per
computer, never in the collection. A damaged file means nothing is allowed. Permissions given before
this list existed are taken over once, without asking again.

**One door.** Everything that writes to the collection lives in `modules/changes`, and only its
`ChangeGate` hands work to Anki's worker. `addon/tests/test_architecture.py` enforces both, and each
file there names the permission it needs. The gate checks that permission in Python right before the
work runs, and again on the worker, because a permission can be taken back in between.

- Ongoing work, such as keeping the phone card current, needs "Always allow" (`run`, `before_sync`).
- A single change (`apply`) asks the person unless they allowed it for good. It is a named step in
  Anki's undo history ("Statly: …") and an entry in `statly_data/changes.json`, so it can be undone
  in Anki or in Statly. Statly's undo only puts a value back if nobody changed it since.
- The assistant's changes always ask, and then only "Only this time" is offered. No assistant tool
  reaches `permissions.*`, `changes.*` or `mobile.*`, which a test checks.
- Changes Statly makes on its own wait while a review is on screen or a redo is waiting. A write in
  that moment would slow down answering or destroy the redo.

**Today's limit of new cards** (`deck_limits.py`, permission `anki.deckLimits`) is the first change
the person can start. A study goal's notice offers "Raise for today" when a deck shows fewer new
cards than the goal plans. The page names only the goal: Python works out which decks need how
many, the deck itself and every deck inside it, because Anki applies the limits of subdecks too.
The popup lists each deck with its old and new number. The change writes nothing but each deck's
`newLimitToday` through `decks.update_dict`, all decks in one named undo step, and it only ever
raises: a limit someone set higher in between stays as it is. With "Always allow", Statly raises
what a goal needs by itself on the overview of the deck about to be studied, never during a
review, and at most three times a goal and day: after an undo it raises again on the next
overview, so changing one's mind works, and after the third undo it leaves the limits alone until
tomorrow. While Anki offers to redo an undone raise, Statly waits, because a write would throw that
redo away. Anki shows a short note of what changed and how to undo it, and Statly shows the same
with an undo button. The assistant
cannot reach any of this: its tools only read, a list in `ToolBox` refuses every call that
changes Anki or allows something even if a tool named one, and tests check both.

The rules from the phone card still hold for every write: no full sync, the person's undo history
stays intact, nothing writes before a session's first sync where that matters.

## Measured behavior

On Anki 25.09.4 and 26.09.3:

- Writing a deck with `decks.update_dict` adds its own undo step and keeps the person's earlier ones.
  Wrapped in `add_custom_undo_entry` and `merge_undo_entries`, it becomes one named step. The schema
  time stays the same, so no full sync follows.
- `set_config` keeps the undo history, marks the value for the normal sync and leaves the schema time
  alone. With `undoable=True` inside a custom step, it can be undone.
- Both clear a waiting redo, like any action in Anki. That is why automatic changes wait for it.
- A setting written with `set_config` reaches another collection with a normal sync, through
  Anki's own sync server, while removing a setting does not travel: the other collection keeps
  it. Syncing goals therefore switches off by writing an "off" entry.

## What this does not protect against

Other add-ons run in the same process and can call Anki directly, and no code in that process can
stop them. The popup protects against the web page and the assistant, not against code that already runs
inside Anki.
