# Security

## Reporting a problem

Please report vulnerabilities through **private vulnerability reporting** under the repository's
**Security** tab, not in a public issue. If you have no GitHub account, write to
statly.anki@gmail.com. Include the Statly and Anki versions and the steps to reproduce it. Never
include a real API key or anything from your own collection.

You will get a first answer within two weeks. Statly is a volunteer project, so a fix may take longer,
and you will be told how it is going. Only the latest release gets fixes.

## What counts

Especially welcome are reports of anything that lets:

- a model, a shared widget, a deck name or a card make Statly act without the person's consent
- a web page or another program reach the local API without the connection code
- a key leave the keychain, reach a log, a file or the web app, or reach another service
- Statly change anything in a collection beyond its own note, deck and note type
- a widget file run code or read files

## What is outside Statly's reach

Anki loads every add-on into one process with the same rights. Statly cannot protect you from another
add-on written to attack it. The optional key password stops other add-ons and programs from reading
a key out of the keychain unnoticed, but one that targets Statly can still catch a key after you
unlock it. [ADR 0002](docs/adr/0002-how-the-assistant-stays-safe.md) explains the full model and its
limits.
