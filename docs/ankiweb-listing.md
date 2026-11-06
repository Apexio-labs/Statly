# AnkiWeb listing

The text for the add-on's page on AnkiWeb. AnkiWeb accepts simple HTML.

**Title:** Statly: your own statistics dashboard

---

<b>Anki knows a lot about how you learn. Statly puts it on one page that you arrange yourself.</b>

Free, open source and local. No account, no telemetry.

[IMAGE 1]

<b>Your own dashboard.</b> Drag and resize widgets, filter by time range and deck, and pick a theme, including Frutiger Aero.

<b>All of Anki's statistics as widgets.</b> The same numbers as Anki's statistics page, with stability, difficulty and retrievability if you use FSRS.

<b>A clearer picture of your habits.</b> A yearly heatmap with streaks, your study times by weekday and hour, true retention, and a forecast of the coming week.

[IMAGE 2]

<b>Study goals.</b> Pick your decks and an exam date. Statly spreads the cards over the days before it, every morning anew, and shows the day's goal as a ring on your dashboard, deck by deck. It estimates how long today takes by your own pace, keeps a streak and tells you the moment the goal is met. If a deck shows fewer new cards than the plan needs, Statly offers to raise today's limit, after asking you. Goals can sync to your other computers through AnkiWeb, if you allow it.

<b>Reviews that count cards.</b> A review is a card that moved on to a later day, counted once a day. Every press of Again, Hard, Good or Easy is a rating, and both have their own widgets.

<b>Widgets of your own.</b> Build them without code. They are plain data, so a shared widget cannot run anything on your computer.

<b>Your dashboard on your phone.</b> Statly can put it on a card that travels with the normal Anki sync, arranged for phones and tablets. No server is involved. The card shows the state of your last desktop sync. It is tested on iPhone with AnkiMobile. AnkiDroid should work but is untested so far, so reports are welcome.

[IMAGE 3]

<b>An assistant, if you want one.</b> Ask about your learning with your own API key or a local model through Ollama or LM Studio. It can read your study goals and suggest one, which becomes a goal only when you save it. It can never change your cards, needs your permission to read them, and by default every suggestion waits for your click. Connections to cloud services are still marked as beta.

<b>Your data stays yours</b>

Statly reads your collection and never changes your cards or notes. It writes to Anki only after you allow it in its own popup: its phone card, today's new card limit for a study goal (one step in Edit → Undo, and it only ever raises it), and a small entry for syncing goals. Privacy & Security in its settings lists every permission and every change. Automated tests run the statistics in the middle of a review session and check that nothing changes. There is no telemetry, no account and no server of ours. If you use a cloud assistant, what you ask goes to the service you chose.

<b>How Statly is made</b>

Statly is built with agentic coding. An AI coding agent, Claude Code, wrote nearly all of the code. A person decides what gets built and tries the result in real use. You should know that before you install it.

So please do not just take our word for anything. All the code is public on <a href="https://github.com/apexio-labs/statly">GitHub</a> under the GNU AGPL, version 3 or later. More than 800 automated tests run on every change, and the add-on's tests run on Windows, macOS and Linux against Anki 25.09 and 26.09. The security review so far was AI-assisted too, and there has been no independent audit. If you find a problem, please tell us.

<b>Early days</b>

Version 2 is a complete rewrite, and 2.1 adds study goals, so expect a few rough edges. A <a href="https://github.com/apexio-labs/statly/issues">bug report on GitHub</a> helps more than a bad review, because we can answer it there. If Statly is useful to you, a thumbs up helps others find it.

<b>Updating from 1.x?</b> Your settings and dashboard layout carry over. Widgets you built yourself in 1.x do not.

<b>Requirements:</b> Anki 25.09 or newer.

Sponsored by <a href="https://oldschooltimeless.com">Oldschool Timeless</a>. Statly shows this in its settings, never on your dashboard.
