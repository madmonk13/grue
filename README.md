# Grue

A web-based Z-machine interpreter (the format Frotz plays) where you can
**tap your choices** instead of typing them, or type as usual.

- Built-in library of Zork I, II and III, loaded directly from Microsoft's
  MIT-licensed release on GitHub ([historicalsource](https://github.com/historicalsource))
- Open any Z-code file (`.z1`–`.z5`, `.z7`, `.z8`) or Blorb (`.zblorb`) from your device or a URL
- E-reader themes (Paper, Sepia, Dusk, Night, Phosphor), three typefaces, text size, line spacing and margins
- Mobile first: bottom-sheet menus, a compact compass, and the action panel folds away while you type
- Autosaves after every move; reloading the page drops you straight back into the story you were reading
- Named save slots via `save` / `restore`
- An automatic map of the places you've visited, with tap-to-walk
- No build step and no dependencies

## Running it

It's a static site. Serve the folder with any web server:

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765>. Opening `index.html` straight from disk mostly works too,
but browsers limit storage for `file://` pages, so a server is recommended.
To use it on a phone, host the folder anywhere static (GitHub Pages, Netlify, etc.).

## How the clickable choices work

`js/choices.js` reads the running game's memory:

| Choice | Source |
| --- | --- |
| **Compass** | Only directions with an exit from the current room are enabled. Infocom games store each direction's property number in the dictionary; Inform games name it on their compass objects (`door_dir`). Exits that only print a refusal ("The door is boarded") stay disabled, as do Infocom's hidden exits until their flag is set. Everything is enabled in the dark or when a game's exit data can't be read. |
| **Here** | The object tree under the current room, filtered to things the game has actually *mentioned* since you arrived, so a closed mailbox doesn't reveal its leaflet |
| **Carrying** | Children of the player object (found by the object that answers to "me") |
| **Verbs** | The game's own dictionary, using its part-of-speech flags, alphabetized with an A–Z filter |
| **Map** | Built from moves you actually make, so one-way passages and mazes are mapped as they behaved. Rooms are laid out by compass direction; unexplored exits (from the same exit data the compass uses) show as stubs. Moves with no direction (magic words, "climb tree") appear as dashed, labelled links. Tap a room to walk there by the shortest known route; the walk stops if a move goes somewhere unexpected. Saved with autosaves and save slots. |
| **Words in the story** | Nouns the parser knows are underlined; tapping one adds it to the command you're building (turn this off in Reading settings) |

Tap an object for an action sheet (Examine, Take, Open, Put in…). You can also build a
command in pieces: tap a verb, then an object (it sends automatically), or tap
`Put in…` and then the container. Tapping underlined words in the story only adds
text, so you can gather nouns first and then choose a verb to put in front. Anything you type in the command bar works as normal,
and tapped words are added to what you've typed.

## Files

| File | Purpose |
| --- | --- |
| `js/zmachine.js` | Z-machine interpreter (v1–5, 7, 8; not v6 graphics) |
| `js/choices.js` | Derives compass/objects/verbs from game memory |
| `js/automap.js` | Records visited rooms and connections, lays them out, finds routes |
| `js/mapview.js` | Draws the map as a pannable, zoomable SVG |
| `js/app.js` | UI, library, saves, settings |
| `js/storage.js` | IndexedDB (story files) and localStorage (settings, saves) |
| `css/style.css` | Layout and themes |

## Limitations

- Version 6 games (Zork Zero, Shogun, Journey, Arthur) aren't supported.
- No sound, colours (the theme sets them), or timed input.
- Saves use this app's own format rather than Quetzal, so they can't be moved to Frotz.
- Object detection is heuristic. It's tuned on Infocom and Inform 6 games; some games
  may list scenery or miss an unusual object. Typing always works.
