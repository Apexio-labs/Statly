# To-do

## Widget-Leiste im Bearbeiten-Modus überdenken

**Gemeldet in Issue #6, bewusst noch nicht umgesetzt.**

Die Leiste wirkt beim Bearbeiten des Dashboards überladen und zeigt nicht, was die Widgets tun.
Seit dem 3. November 2026 sind ihre Gruppen standardmäßig eingeklappt, was die Überladung mildert.
Offen bleibt, dass sie nicht zeigt, was die Widgets tun. Vorschlag aus dem Issue: sie im
Bearbeiten-Modus entfernen. Vorher klären, wie man dann neue Widgets
hinzufügt und wo Export und Import bleiben, denn beides liegt heute in dieser Leiste.

## Selbstreparatur der Handy-Karte greift beim reinen Sync nicht

**Gemeldet am 01.11.2026, getestet auf dem Handy.**

- Funktioniert: Karte auf dem Handy beschädigen, synchronisieren, Statly am Desktop öffnen, dann
  synchronisieren.
- Funktioniert nicht: Karte beschädigen und am Desktop nur synchronisieren.

**Vermutete Ursache, noch nicht getestet:** `modules/mobile/__init__.py` prüft die Karte vor dem Sync.
Da liegt die beschädigte Fassung noch nicht auf dem Desktop. Nach dem Sync setzt
`on_sync_finished` nur einen Zeitgeber zurück, repariert wird erst beim nächsten
`on_deck_overview`. Selbst dann bleibt die Reparatur lokal, bis erneut synchronisiert wird.

**Lösungsidee:**

1. Direkt nach dem Sync `needs_repair` prüfen und die Karte reparieren.
2. Danach genau einen weiteren Sync anstoßen, damit die Reparatur aufs Handy kommt, mit einer Sperre
   gegen Endlosschleifen. Der automatische Sync der Person muss dabei respektiert werden.
3. Einen Test ergänzen, der die beschädigte Karte durch einen echten Sync bringt.

## Lernziele – Version 2 und später

**Bewusst nicht in Version 1, vorbereitet im Plan vom 04.11.2026.** Version 1 sammelt schon die
Daten, die diese Punkte brauchen.

- **Lerninhalt als Merkmal:** Textlänge, Bilder, Audio und Lücken einer Karte fließen in die
  Lernzeit ein, damit neue Decks ohne Verlauf gut geschätzt werden. Später durch ML ersetzbar, mit
  derselben Schnittstelle wie das Modell aus Version 1.
- **Wiederholungs-Limit beachten:** In Anki zählen neue Karten auch gegen das Limit für
  Wiederholungen, wenn „Neue Karten ignorieren das Wiederholungslimit“ aus ist. Dann hilft ein
  höheres Limit für neue Karten nicht. Statly sollte das erkennen und darauf hinweisen.
- **Stoppuhr auswerten:** die ab Version 1 gesammelten Messungen eichen das Lernzeit-Modell.
- **Tagesform:** Uhrzeit, Sitzungslänge und Wochentag ergeben „Wie viel schaffst du realistisch?“,
  mit einer Warnung, wenn der Plan mehr verlangt.
- **Ankis FSRS-Simulator** für die Prognose der Wiederholungen statt des eigenen Echos.
- **Schattenbetrieb:** ein neuer Algorithmus rechnet unsichtbar mit, bis er nachweislich besser ist.
- **Späte Karten vorziehen:** Karten, die Anki erst nach der Klausur wieder zeigen würde, mit
  Erlaubnis vor die Klausur legen.
- **Weitere Zielarten** in der Galerie.
- **Ziele in der Widget-Bibliothek.**
- **Live-Fortschritt auf der Handy-Karte.**
- **Weitere KI-Werkzeuge für Ziele**, jedes mit Begründung und Test.

## Fehlermeldung beim Beenden von Anki aus `host/prompt.py`

**Gefunden am 07.11.2026 im Update-Test, ohne Folgen.**

Beim Beenden meldet Anki manchmal `'PromptLayer' object has no attribute '_window'` aus
`PromptLayer.eventFilter`. Python baut das Objekt dann schon ab, während Qt noch ein Ereignis
zustellt. Abhilfe: den Filter in `PromptLayer` beim Zerstören des Fensters entfernen oder im Filter
`getattr(self, "_window", None)` verwenden.
