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

Tests (need the extracted data): `node web/tests/rules.mjs`, `node web/tests/shots.mjs`.

## What is ported

| Part | Source | Status |
|---|---|---|
| Layout: walls, rails, ramps (surface heights), flippers, bumper, kickers, gates, targets, triggers, spinner, plunger | read from the VPX | faithful positions, sizes, heights and levels (`SURF`) |
| Artwork: lower playfield, upper playfield, apron/plastics, metals | read from the VPX | drawn top-down, no 3D meshes or lighting |
| Physics | rewritten (2.5D, two levels, slopes on ramps, flipper angular velocity) | tuned by hand, not VPX-exact |
| Game rules | rewritten from the table's rule text | approximation; the original runs ROM `bk_l4` in PinMAME |
| Sounds | synthesised placeholders | the table's samples are not reused |
| Insert lamps, 3D primitives, ball reflections, backglass, DMD | not ported | |

## Layout of the repo

- `tools/vpx_extract.py` – reads the OLE2 `.vpx` container (items, images, script).
- `web/js/build.js` – turns the extracted items into collision segments, ramp surfaces and elements.
- `web/js/physics.js` – ball physics. `web/js/game.js` – rules. `web/js/main.js` – rendering and input.

## Not included

`web/data/` and `web/assets/` are git-ignored: they contain the table author's layout and the
Williams/jpsalas artwork. Generate them locally from a `.vpx` you have the right to use.
