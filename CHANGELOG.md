# Changelog

## 2.1.1

- Statly starts again when Anki opens normally. In 2.1.0 it stopped while loading, because it
  read the profile's settings before Anki had opened the profile, so the toolbar kept Anki's own
  Stats link. Statly's own tests had started Anki with a chosen profile, which hid this
- If one part of Statly fails to load, the rest and the toolbar link still work
- The ring of a goal that counts new and due cards no longer says "Almost there: just 0" when
  more new cards than planned were learned while reviews were still open. Each part now counts
  up to its own target, and extra work shows once both are met

## 2.1.0

- The dashboard follows along while you study: after every answer, as soon as the next card
  shows, the widgets count again. Before, they only changed once the deck was closed
- Reviews now count cards, not clicks: a card counts once a day as soon as an answer moves it to a
  later day. Three answers to one new card are one review, and a card that is still in its steps at
  the end of the day counts on the day it moves on. This applies everywhere Statly says "reviews",
  from the dashboard to the phone card, the deck overview, study goals and the assistant. Anki's
  own statistics stay as Anki counts them
- The old number lives on as ratings, every press of Again, Hard, Good or Easy. Ratings, Ratings
  over time, Ratings by deck, Study times by ratings and Ratings over the year sit next to their
  review twins in the library, and custom widgets can show ratings too. The success rate is a
  share of ratings, as before
- Study goals: a new page in the sidebar sets up an exam goal. Statly spreads the cards of the
  chosen decks over the study days before the exam, every morning anew, and shows the day's goal
  as a ring on the dashboard. Decks are chosen with checkboxes, and one calendar sets the exam
  day, the buffer before it and days off. A live preview shows the numbers while setting it up
- A goal's ring shows each deck and its subdecks around the day's goal, like a disk usage chart.
  Clicking a deck zooms into it, the middle goes back. Each part turns red, yellow or green with its
  share, and cards still in their learning steps show lighter. A timeline shows the same day as a
  bar and the way to the exam below it, with ticks, forecasts, buffer and days off
- Each goal has its own page with today's ring, the way to the exam, the numbers, a table of decks,
  the streak with badges at 3, 7, 14, 30, 50 and 100 days, and what needs attention
- Meeting the day's goal is celebrated once a day, quietly when the system reduces motion
- Pages below others have an arrow back, and their title opens a menu of the pages above them.
  This works on a goal, while setting one up and in the widget editor
- Pointing at a deck in a goal's ring moves it out a little and shows its numbers in the middle,
  and the same deck lights up in the table below. The way to the exam names each day under the
  pointer, and its days rise into place when the page opens
- A right click on a goal on the dashboard opens it in Goals
- While you study, Statly counts along and Anki shows a short note the moment the day's goal is
  met. It can be switched off under Settings. Answers stay as quick as before: Statly only counts
  once the next card is on screen and never makes Anki load a card again
- Statly measures how long you really look at each card, including looks you took back with undo,
  so it can estimate study time better than Anki's history. Only card, deck, moment, duration and
  button are kept, in Statly's own file on this computer, never what a card says
- Study goals say how long today takes and how much of it is left, by your own pace: "≈ 34 min to
  go" in the ring, and on the goal's page the day's time with a range, split into new cards and
  reviews. The estimate also counts answers Anki cut off at its time limit and looks you undid
- A study goal can also have every card seen once more before the deadline. Statly then learns new
  cards earlier, by the days your cards take to come back, counts which ones were seen again and
  names cards Anki would show only after the deadline
- When a deck shows fewer new cards than a study goal plans for today, the goal offers to raise
  today's limit. Statly asks first in its own popup and lists each deck with its old and new
  number, changes nothing but that limit for today, and only ever raises it. The change is one step
  in Anki's Edit → Undo and comes with an undo button in Statly. With "Always allow", Statly does
  it by itself right before you study that deck and says so in Anki, up to three times a day, so
  you can change your mind
- The assistant knows your study goals: it reads today's progress, streak and time left, and can
  suggest a goal. A suggested goal opens the setup page filled in, and becomes a goal only when you
  save it there, also in the automatic mode. Without permission for deck names, it sees goals and
  decks only as numbers
- Study goals can sync through AnkiWeb to your other computers, if you allow it: the first goal
  asks once, and the switch is under Privacy & Security. Each computer keeps a small entry of its
  own in the collection's settings, so nothing is overwritten, a deleted goal stays deleted, and
  every computer counts the same day's goal. It needs no full sync and leaves your undo as it is
- Study goals on the dashboard also reach the phone card: the day's progress as a ring or bar,
  what is left, the streak and tomorrow, with the time the card was made
- The way to the exam shows the reviews expected on each coming day, from cards already due and
  from planned cards coming back as yours usually do
- Pages below others have their arrow back right after the divider, and their title opens the menu
  of pages above it without a separate arrow
- A new section, Privacy & Security, lists everything Statly may do and every change it made in
  Anki, and takes any permission back
- Statly now asks for permissions in a popup of its own over the app, which neither the page nor the
  assistant can press. Permissions given earlier stay as they are
- The assistant's settings moved to their own section under Settings. The chat can allow reading for
  itself only, and "Always allow" leads to the switch in the settings
- Uninstalling and closing with unsaved work ask in Statly's own popup instead of Anki's dialog
- Statly is now licensed under the AGPL-3.0-or-later, with a commercial license for companies. Version
  2.0.0 stays under the MIT License
- Frutiger Aero is rebuilt after Windows Vista: glass widgets over a new wallpaper, glossy icons and
  logo, the blue sidebar with its reflection, red close buttons and Vista's buttons and scroll bars
- The Widget Library in Frutiger Aero looks like Vista's gadget gallery, with a Vista dialog for
  the preview
- Widgets wobble again while the dashboard is being edited, gently in the solid themes
- A new widget shows how many different cards you learned, not how many answers you gave
- A wallpaper can now lie behind all of Statly in every theme, as a picture or a video, and also
  behind Anki's deck overview. Files can be dropped onto the preview or chosen by clicking it, and
  the last eight come back from a history that also holds the Frutiger Aero sky
- An own accent color can replace the theme's, charts and widgets included
- Pointing at a color and pressing Delete puts back its default
- The widget panel starts with its groups folded and can reset the dashboard, after asking first
- Settings open where you left them when you come back within three minutes
- "All decks" lines up with the decks below it, and Statly's own phone deck is no longer offered
- After some weeks of use Statly asks once whether you want to recommend it, with the system's
  share sheet on macOS
- Eight more actions can get a keyboard shortcut, among them editing the dashboard, the assistant,
  the next theme and full screen. The assistant's shortcut also closes it again, and a taken
  shortcut is now explained right under its row
- Fixed: in Frutiger Aero, pages flickered when opening, after closing the editor and while
  resizing widgets
- Fixed: switches that were on looked off in Frutiger Aero
- Fixed: cards wobbled more the further down the dashboard they sat
- Fixed: on Windows a chosen wallpaper was never stored, without any message
- Fixed: date fields showed the German placeholder in English

## 2.0.0

Statly was rebuilt from the ground up and is now open source under the MIT License.

- A new dashboard with a free grid, time and deck filters, themes and background pictures
- Every section of Anki's statistics page as a widget, with Anki's own numbers
- A widget editor without code, with a Widget Library, favorites, import and export
- A phone and tablet dashboard through a card, arranged per device, with a closer look at each
  statistic. A card damaged on a phone repairs itself from the desktop
- An optional assistant with your own key or a local model, which needs permission for cards and
  decks and can never change them
- A connection for other AI apps through MCP
- API keys in the system's keychain, optionally behind a password
