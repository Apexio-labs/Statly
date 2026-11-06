# 2. How the assistant stays safe

## Context

Statly talks to AI services with the user's own key, and external apps can connect to it. Models
can be tricked: a deck name, a widget name or a shared file may contain text written to steer them.
Instructions to a model are therefore no protection at all.

## Decision

Everything that matters is decided in code, in places a model cannot reach.

**Keys.** A key goes into the keychain of the operating system, which encrypts it: the macOS
keychain, the Windows Credential Manager or the secret service on Linux. A test proves it cannot be
read in the keychain file. Without a keychain, it stays in memory until Anki closes and is never
written to a file. Statly holds it in memory only while an answer is being written, and uninstalling
removes it. No call returns a key, so not even a compromised web page could read one. On macOS the key reaches the keychain through stdin, because command arguments are
visible in the process list. Errors from a service are scrubbed before they are shown, redirects
are refused, and plain HTTP is only allowed to this computer. A key for a known service only ever
goes to that service's own address.

**Extra password.** Anyone can add a password under Advanced, and it stays optional because it costs
typing and a forgotten password means entering the keys again. With it, the keychain holds only
sealed values, so another add-on or program can no longer read a key from there unnoticed.

The password opens a random data key through scrypt, and that key seals the API keys. Changing the
password rewrites one keychain item, so a crash cannot strand a key, and tests stop the keychain
halfway through every step to prove it. Each sealed value is bound to its provider, so items cannot be
swapped. Anki brings no cryptography package and an add-on cannot ship a compiled one, so `modules/ai/keys.py`
encrypts with HMAC-SHA256 in counter mode and authenticates with a second HMAC, both from the standard
library. Neither the password nor the data key is ever stored. The data key stays in memory until Anki
closes, the profile changes or someone presses "Lock now", and an API key is only opened for one answer.

**Reach.** `packages/contract/src/aiTools.ts` is the complete list of what a model can do. Reading
tools map to a fixed set of calls, four tools suggest changes, and two tools only guide inside the
app. Tool definitions stay short so they fit into the small context of local models, but what comes
back is checked against the full format. There is no tool that changes cards, notes or decks, and
none for keys, the phone card, uninstalling or these switches. Nor can it raise a deck's limit of
new cards for a study goal: behind the tool list, `ToolBox` refuses every call that changes Anki,
allows something or saves a goal (`NEVER_CALLED`), even if a tool named one, and no file of the
assistant names the door for changes. Settings go through an
allow-list twice: the tool's schema and `ChangeBook` both refuse anything else. `addon/tests/test_ai.py`
fails if a tool reaches for anything beyond this.

**Permissions.** Deck names and card contents need a person's permission, enforced in `ToolBox`
and not by what the model is told. The chat stops and asks with buttons that allow only this chat.
Allowing for good is a switch under Settings → AI, which asks in Statly's own popup, as described in
[ADR 3](0003-permissions-and-changes.md). Settings → Privacy & Security shows and takes back every
permission. External apps cannot ask, and what the chat may see reaches them only through a
permission of its own. Reading cards goes through Anki's search and plain `SELECT` statements, so it
cannot touch the undo history.

Taking a permission back counts at once, also in the chat that was given it.

Card text is the most likely place for hidden orders. Once a chat has read a card, nothing in that
chat applies by itself anymore, even in the automatic mode. That stays true after reopening the chat
from its history, because the card text comes back with it.

**Changes.** A suggestion waits until a person accepts it in the app. No tool and no route of the
local API can accept one. Every applied change stores what it replaced and can be rolled back. A
change the assistant suggests for Anki itself goes through the gate in `modules/changes` and asks in
Statly's dialog every time, even when the person allowed such changes for good.

**Automatic mode.** It is off by default and sits under Advanced behind a warning that has to be
confirmed. External apps need a second switch on top. Even then, at most five changes per minute
apply on their own, and every one lands in the same log.

**Study goals.** `get_goals` reads a short overview of every goal: today's numbers, the streak,
the minutes left and the kinds of notices, through the read-only call `goals.overview`. A goal's
name is mostly a deck's name, so without permission for deck names both become numbers ("Goal 1",
"Deck 1"), like every other deck name the assistant reads. `propose_goal` suggests a goal or a
change to one, checked against the goal format before it becomes a suggestion. A suggested goal is
never saved by the assistant, by its card or by the automatic mode: its card only opens the setup
page with the suggestion filled in, marked as one, and the goal exists only once the person saves
it there through the normal call. Only then does `ai.applyProposal` record it, and only for the goal
that really was saved; rolling it back removes the new goal or puts the earlier settings back. This
matters because a goal can lead Statly to raise a deck's limit of new cards when the person allowed
that for good, and such a change needs a person every time an assistant is involved.

**The bridge** answers only the app's own page. Every call is open to that page, so a foreign page
that somehow ended up in the window would otherwise get all of them, including what sends a key.

**Text from a model** is never treated as HTML. Links and images stay plain text, so a manipulated
answer cannot carry data away in an address. The page's Content Security Policy blocks any other
connection as well.

**External apps** reach a server that listens only on 127.0.0.1, is off by default and answers only
with the connection code. Only a hash of the code is stored, and ten wrong guesses lock it until a
new code is made. Requests with an `Origin` header or a foreign `Host` are refused, which keeps web
pages out, including DNS rebinding.

## What this does not protect against

Other Anki add-ons run in the same process with the same rights, and no code inside that process can
wall them off. Without the extra password they, and other programs of the same user, can ask the
keychain tool for an item it created. With it, they get a sealed value and would have to guess the
password. An add-on built to attack Statly can still wait for the moment after unlocking, or fake the
password field, so the app says this next to the switch. The tip to use a separate key with a spending
limit covers what remains. A helper process outside Anki would not close this gap either, because
add-ons could still use it, and it would add fragile platform-specific code.

The service itself sees what it is sent, which is why the first use explains exactly what that is.

## Why plain HTTP instead of the Anthropic SDK

An Anki add-on cannot ship packages compiled for each operating system. Python talks to every
service through `requests`, which Anki already brings along. Anthropic's Messages API has its own
client in `modules/ai/providers.py`, everything else speaks the OpenAI-compatible format.
