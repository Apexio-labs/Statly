# Contributing to Statly

Thanks for helping. Bug reports, translations, widget templates and code are all welcome.

## Before you start

- For anything larger than a small fix, open an issue first, so nobody builds something that cannot
  be merged.
- Never develop against your real collection. `scripts/dev_anki.py` and `scripts/smoke_anki.py` use
  their own data folders, and `run_anki.py` refuses a real one.
- Read [docs/architecture.md](docs/architecture.md). It is short and explains where things go.

## Rules that are not up for debate

These protect people's cards, and tests enforce them:

1. **Statistics only read.** Everything goes through `core/reader.py`, which accepts plain `SELECT`
   statements. Anki treats anything else, even a `WITH` query, as a change, and that clears the
   user's undo history.
2. **Only `modules/mobile/writer.py` writes to the collection**, and only to Statly's own note,
   deck and note type. `addon/tests/test_architecture.py` fails if another file tries.
3. **`aqt` stays in `host/`.** Modules reach Anki through the `Host` interface in `core/module.py`.
4. **Data formats live in `packages/contract`.** Change them there and run `pnpm contract`. Do not
   edit the generated files in `addon/src/statly/contract/`.
5. **Widgets stay data.** No widget format may ever contain code or HTML.
6. **The assistant cannot change cards.** No tool for that will be accepted. See
   [ADR 0002](docs/adr/0002-how-the-assistant-stays-safe.md).
7. **Text goes into `packages/i18n/locales`**, in English and German. Python returns data, not
   sentences. The card is the exception, because it cannot reach those files.

## Making a change

1. Fork the repository and create a branch.
2. Make the change, with tests. Statistics tests run against real Anki collections, not mocks, and
   state the exact numbers they expect.
3. Run the checks from the [README](README.md#development). Run `scripts/smoke_anki.py` if you touched
   anything in `host/` or the bridge.
4. Open a pull request. Use [Conventional Commits](https://www.conventionalcommits.org/) for the
   title, such as `feat: add a retention widget` or `fix: count suspended cards`.

## Translations

Language files are in `packages/i18n/locales`. A test makes sure every language has the same keys.
Card text is in `addon/src/statly/modules/mobile/labels.py`.

## Security

Please do not report security problems in public issues. See [SECURITY.md](SECURITY.md).

By contributing, you agree that your work is published under this project's [license](LICENSE).
