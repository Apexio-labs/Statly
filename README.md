# Statly

A statistics dashboard for [Anki](https://apps.ankiweb.net/) that you arrange yourself.

Sponsored by [Oldschool Timeless](https://oldschooltimeless.com).

## What it does

- **Your own dashboard.** Drag and resize widgets on a free grid, filter by time range and deck,
  and pick a theme and a background picture.
- **Anki's statistics as widgets.** Every section of Anki's statistics page, with Anki's own numbers
  and FSRS values, plus Statly's own widgets.
- **Your own widgets, without code.** Build them from text, numbers, charts, pictures and shapes.
  Widgets are plain data, so sharing one can never run code on someone's computer.
- **Study goals.** Set an exam date and Statly spreads the cards of the chosen decks over the days
  before it, shows the day's goal as a ring, estimates how long today takes by your own pace and
  keeps a streak. Goals can sync to your other computers through AnkiWeb.
- **Your dashboard on your phone.** A card that travels with the normal Anki sync shows it on
  phones and tablets, with a layout worked out for each device. No server is involved.
- **An assistant, if you want one.** Ask about your learning with your own API key or a local model
  through Ollama or LM Studio. Other AI apps can connect through MCP.

## Your data and your cards

Statly reads your collection and never changes your cards. It writes to Anki only after you allow it
in its own popup: its phone card, for a study goal how many new cards a deck shows today, and, if
you let goals sync, a small entry of its own in the collection's settings. A changed limit is a step
you can undo with Anki's Edit → Undo, and Privacy & Security lists every change and permission.
It sends nothing anywhere by itself: no telemetry, no account, no server of ours.

The assistant is off until you set it up. Everything it can do is listed in
[docs/adr/0002-how-the-assistant-stays-safe.md](docs/adr/0002-how-the-assistant-stays-safe.md):

- It can never change cards, notes or decks, raise a deck's limit or allow anything.
- It needs your permission to read card contents or deck names, and you can take that back.
- Changes to widgets and settings wait for your click, and every one can be rolled back.
- API keys stay in your system's keychain, optionally behind a password of your own.

If you use a cloud service, what you ask goes to that service under its own terms. Local models
keep everything on your computer. Connections to the cloud services are marked as beta, because they
could not be tested with real keys yet.

## Requirements

Anki 25.09 or newer. The phone card works with AnkiMobile. AnkiDroid should work the same way, and
reports are welcome.

## Development

You need [Node.js](https://nodejs.org/) 24 or newer, [pnpm](https://pnpm.io/) and
[uv](https://docs.astral.sh/uv/).

```sh
pnpm install
uv sync
pnpm build                   # build the web app into the add-on
uv run python scripts/dev_anki.py
```

`dev_anki.py` starts a separate Anki with its own data in `.dev/`. It never opens your real
collection. For interface work without Anki, run `pnpm dev`: the app then uses simulated data.

| Task                           | Command                                                  |
| ------------------------------ | -------------------------------------------------------- |
| All web checks                 | `pnpm lint && pnpm typecheck && pnpm test`               |
| Browser tests                  | `pnpm --filter @statly/web e2e`                          |
| Run inside real Anki           | `uv run python scripts/smoke_anki.py`                    |
| Speed check, 1M reviews        | `uv run python scripts/bench_statistics.py`              |
| Try it with fake reviews       | `uv run python scripts/dev_anki.py --demo`               |
| All Python checks              | `uv run ruff check . && uv run pyright && uv run pytest` |
| Regenerate shared data formats | `pnpm contract`                                          |
| Build `dist/statly.ankiaddon`  | `pnpm build && uv run python scripts/build_addon.py`     |

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/architecture.md](docs/architecture.md). The
[guides](docs/guides) walk through adding a statistic or a whole module.

## License

Statly is free software under the [GNU Affero General Public License](LICENSE), version 3 or later.
Companies that cannot meet its terms can get a commercial license, see [LICENSING.md](LICENSING.md).
Version 2.0.0 was published under the MIT License and stays available under it. The Statly and
Oldschool Timeless names and graphics are not part of either license, see
[TRADEMARKS.md](TRADEMARKS.md). Third-party components keep their own licenses, listed in
`THIRD_PARTY_NOTICES.txt` inside the built add-on.
