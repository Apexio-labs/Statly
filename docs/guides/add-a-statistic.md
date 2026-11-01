# Add a statistic

A built-in statistic is a Python function that reads, a call in the contract, and a React component
that draws it. Here is a widget that shows how many cards are suspended.

## 1. Work out the number

Add a function to `addon/src/statly/modules/statistics/metrics.py`. Read through the reader, pass
values as `?` parameters, and leave Statly's phone card out with `card_filter`:

```python
def suspended(params: Any, reader: CollectionReader) -> types.StatisticsSuspendedResult:
    conditions, parameters = card_filter(deck_ids(reader, params["deckId"]), reader.excluded_cards)
    cards = reader.scalar(
        f"SELECT COUNT(*) FROM cards WHERE {conditions} AND queue = ?",
        *parameters,
        QUEUE_SUSPENDED,
    )
    return {"cards": cards}
```

Register it in `_METRICS` in `modules/statistics/__init__.py`. Results are cached until the collection
changes, so there is nothing else to do for speed.

## 2. Describe it in the contract

In `packages/contract/src/rpc.ts`, add the call with its parameters and result. Run `pnpm contract`,
which regenerates the Python types. A test fails if a call has no handler.

## 3. Make it a widget

In `packages/contract/src/dashboard.ts`:

- add it to `builtinWidgets` with the sizes it allows
- add it to a group in `widgetGroups`
- say what kind it is in `widgetKinds`

## 4. Draw it

Add a component to `apps/web/src/features/dashboard/widgets.tsx` and to `widgetComponents`, and a small
picture to `PICTURES` in `features/library/Thumbnail.tsx`. TypeScript reports both if they are
missing. Use `useStatistic` to read, and `WidgetCard` and `WidgetState` for loading and error states.

Add the simulated result to `apps/web/src/bridge/mockStatistics.ts`, so `pnpm dev` and the browser
tests can draw it.

## 5. Bring it to the phone

In `addon/src/statly/modules/mobile/snapshot.py`, teach `statistic` to build a block for it, and add
its label to both languages in `labels.py`. Without this, the widget stays off the card, and
`test_snapshot_covers_every_built_in_statistic` fails. If its value does not depend on a time range,
add it to `deviceTimeless`.

## 6. Write the text

Add `title`, `note` and `description` under `widgets.<your-widget>` in
`packages/i18n/locales/en.json` and `de.json`.

## 7. Test it

Add a test to `addon/tests/test_statistics.py` that builds exact data and states the exact number it
expects. Add your call to `all_calls` if it is not found by itself: that test runs every statistic in
the middle of a review session and proves nothing changed.

## Let the assistant read it

If the number is useful in a chat, add it to `aiStatistics` in `packages/contract/src/aiTools.ts`.
Keep the description short: tool definitions go out with every request, and local models have little
room.
