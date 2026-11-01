# Add a module

Everything Statly does lives in a module. The statistics, the dashboard, the widgets, the phone card
and the assistant are all built the same way, and a new feature can join them without changing the
core.

## The shape of a module

A module is a class with a `register` method, in a folder of its own under
`addon/src/statly/modules/`:

```python
class FlashcardGoalsModule:
    def register(self, context: Context) -> None:
        goals = Goals(JsonStore(context.host.data_folder))
        context.router.local("goals.list", lambda _params: goals.list())
        context.router.query("goals.progress", goals.progress)
```

Add it to `MODULES` in `modules/__init__.py`. Order matters only if a module uses another's service.

## What a module gets

`Context` holds everything a module may use:

- `router` registers calls from the web app. `local` runs on the main thread and must be quick,
  `query` reads the collection on Anki's worker, and `deferred` answers later, for dialogs and slow
  work.
- `host` is the only way to reach Anki: windows, hooks, the keychain and background work. It lives in
  `core/module.py`, and `host/runtime.py` implements it. Add to it rather than importing `aqt`.
- `settings` reads and changes the user's settings.
- `services` lets modules use each other, such as `context.services["widgets"]`.
- `events` passes news between modules without tying them together.

## Rules

- Calls go in `packages/contract` first. Run `pnpm contract`, and a test makes sure every call has a
  handler.
- Read the collection through `CollectionReader`. A module cannot write to it: only
  `modules/mobile` may, and tests enforce that. If your idea needs to write, open an issue first.
- Store your own data with `JsonStore`. It writes atomically into the profile folder.
- A hook must never be able to break Anki. `host.on_*` wraps callbacks for you.
- A page for your module goes in `apps/web/src/features/<name>`, with a route in the app's router.
- Should the assistant reach your module, read
  [ADR 0002](../adr/0002-how-the-assistant-stays-safe.md) first. A new tool needs a reason, and it can
  only read or suggest.
