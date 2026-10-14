# Black Knight (Williams 1980) – browser port

A playable HTML5 port of the Visual Pinball X table *Black Knight* (v4.0.0, by jpsalas).
Geometry and artwork are extracted from your own `.vpx` file; physics and rules are
re-implemented in JavaScript.

## Run

```bash
pip install olefile
python tools/vpx_extract.py /path/to/Black_Knight_Williams_1980_v4.vpx web   # writes web/data and web/assets
cd web && python -m http.server 8000                                          # open http://localhost:8000
```

Keys: `1` start, `Enter` plunger (hold, release), `Z`/`←` and `/`/`→` flippers, `A` / `'` Magna-Save,
`Q`/`E` nudge, `D` collision debug overlay. Touch buttons appear on small screens.

Tests (need the extracted data): `node web/tests/rules.mjs`, `node web/tests/shots.mjs`, and with the ROM `node web/tests/rom.mjs`.

## Running the real game ROM

With the MAME ROM set `bk_l4.zip` (you must own it) the port runs the **original game software**:
a System 7 board emulation (6808 CPU, PIAs, lamp/switch/display matrices, solenoid drivers) plus the
sound board (6808, DAC, speech decoder) written in JavaScript – no PinMAME involved.
Place the zip at `web/rom/bk_l4.zip` (git-ignored) or choose it in the page; it is stored only in your browser.
The first start runs the game's one-time self test automatically (about a second); the CMOS RAM
(settings, high scores) is then kept in `localStorage`. Without the ROM the page falls back to the
simplified built-in rules (`?norom` forces that).

Keys in ROM mode: `5` coin, `1` start (adds a coin if there are no credits), `N` ADVANCE (service button).

## What is ported

| Part | Source | Status |
|---|---|---|
| Layout: walls, rails, ramps (surface heights), flippers, bumper, kickers, gates, targets, triggers, spinner, plunger | read from the VPX | faithful positions, sizes, heights and levels (`SURF`) |
| Artwork: lower playfield, upper playfield, apron/plastics, metals | read from the VPX | drawn top-down, no 3D meshes or lighting |
| Physics | rewritten (2.5D, two levels, slopes on ramps, flipper angular velocity) | tuned by hand, not VPX-exact |
| Game rules | the original ROM `bk_l4` on an emulated System 7 board (if you supply it); otherwise rewritten from the table's rule text | ROM mode: original rules; fallback: approximation |
| Sounds | ROM mode: the game's own sound board (DAC + speech); mechanical noises are synthesised | the table's samples are not reused |
| Insert lamps | ROM mode: lit from the ROM's lamp matrix (lamp N = light `lN`) | glow overlay |
| 3D primitives, ball reflections, backglass | not ported | |

## Layout of the repo

- `tools/vpx_extract.py` – reads the OLE2 `.vpx` container (items, images, script).
- `web/js/build.js` – turns the extracted items into collision segments, ramp surfaces and elements.
- `web/js/physics.js` – ball physics. `web/js/game.js` – fallback rules. `web/js/main.js` – rendering and input.
- `web/js/s7/` – System 7 emulation (`cpu6800.js`, `pia6821.js`, `s7machine.js`, `snd67.js`, `rom.js`); `web/js/cabinet.js` connects it to the table.

## Not included

`web/data/` and `web/assets/` are git-ignored: they contain the table author's layout and the
Williams/jpsalas artwork. Generate them locally from a `.vpx` you have the right to use.
`web/rom/` is git-ignored too: the game ROM is never part of this repository.
