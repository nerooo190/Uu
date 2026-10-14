#!/usr/bin/env python3
"""Extract geometry and images from a Visual Pinball X (.vpx) table.

Usage: vpx_extract.py TABLE.vpx OUT_DIR

Writes OUT_DIR/data/table.json (collision/layout data for the web port),
OUT_DIR/data/script.vbs (the table script, for reference) and
OUT_DIR/assets/<image>.<ext> (embedded images, original encoding).

Only dependency: olefile (pip install olefile).
"""
import json
import os
import re
import struct
import sys

import olefile

TYPES = ("Wall Flipper Timer Plunger TextBox Bumper Trigger Light Kicker Decal Gate "
         "Spinner Ramp Table LightCenter DragPoint Collection DispReel LightSeq "
         "Primitive Flasher Rubber HitTarget").split()
STRING_TAGS = {"MATR", "IMAG", "SURF", "SIMA", "TOMA", "SLMA"}
IMAGE_MAGIC = ((b"RIFF", "webp"), (b"\x89PNG", "png"), (b"\xff\xd8\xff", "jpg"),
               (b"#?RADIANCE", "hdr"))


def parse_item(d):
    """Parse one GameItem stream into (props, drag_points).

    Records are [len u32][tag 4 chars][len-4 bytes]. Four-byte values are kept
    as [float, int] because the stream does not say which one a tag is.
    """
    p, props, pts, cur = 4, {}, [], None
    while p + 8 <= len(d):
        ln = struct.unpack_from("<I", d, p)[0]
        tag = d[p + 4:p + 8].decode("latin1")
        v = d[p + 8:p + 4 + ln]
        p += 4 + ln
        if tag == "DPNT":
            cur = {}
            continue
        if tag == "ENDB":
            if cur is not None:
                pts.append(cur)
                cur = None
                continue
            break
        tgt = props if cur is None else cur
        if tag == "NAME":
            tgt[tag] = v[4:].decode("utf-16-le", "ignore")  # u32 length prefix, then UTF-16
        elif tag in STRING_TAGS and len(v) > 4:
            tgt[tag] = v[4:].decode("latin1")
        elif len(v) == 4:
            tgt[tag] = [round(struct.unpack("<f", v)[0], 4), struct.unpack("<i", v)[0]]
        elif len(v) == 8:
            tgt[tag] = [round(x, 3) for x in struct.unpack("<ff", v)]
        elif len(v) == 16 and tag in ("VPOS", "VSIZ"):
            tgt[tag] = [round(x, 3) for x in struct.unpack("<ffff", v)]
        elif tag == "COLR" and len(v) == 4:
            tgt[tag] = list(v[:3])
    return props, pts


def read_name(d):
    i = d.find(b"NAME")
    n = struct.unpack_from("<I", d, i + 4)[0]
    return d[i + 8:i + 8 + n].decode("latin1")


def main(src, out):
    o = olefile.OleFileIO(src)
    os.makedirs(os.path.join(out, "data"), exist_ok=True)
    os.makedirs(os.path.join(out, "assets"), exist_ok=True)

    gd = o.openstream("GameStg/GameData").read()
    i = gd.find(b"CODE")
    n = struct.unpack_from("<I", gd, i + 4)[0]
    open(os.path.join(out, "data", "script.vbs"), "wb").write(gd[i + 8:i + 8 + n])

    def gfloat(tag):
        j = gd.find(tag)
        return struct.unpack_from("<f", gd, j + 4)[0]

    table = {
        "left": gfloat(b"LEFT"), "top": gfloat(b"TOPX"),
        "right": gfloat(b"RGHT"), "bottom": gfloat(b"BOTM"),
    }

    items = []
    for k in range(512):
        try:
            d = o.openstream("GameStg/GameItem%d" % k).read()
        except OSError:
            break
        t = struct.unpack_from("<I", d, 0)[0]
        if t >= len(TYPES):
            continue
        props, pts = parse_item(d)
        items.append({"type": TYPES[t], "name": props.get("NAME", ""), "p": props, "pts": pts})
    keep = {"Wall", "Ramp", "Flipper", "Bumper", "Kicker", "HitTarget", "Trigger", "Gate",
            "Spinner", "Plunger", "Light", "Rubber"}
    table["items"] = [x for x in items if x["type"] in keep]
    json.dump(table, open(os.path.join(out, "data", "table.json"), "w"), separators=(",", ":"))

    images = []
    for k in range(200):
        try:
            d = o.openstream("GameStg/Image%d" % k).read()
        except OSError:
            break
        name = read_name(d)
        body = d[d.find(b"JPEG") + 4:]
        for magic, ext in IMAGE_MAGIC:
            m = body.find(magic)
            if m >= 0:
                fn = re.sub(r"[^A-Za-z0-9_-]", "_", name) + "." + ext
                open(os.path.join(out, "assets", fn), "wb").write(body[m:])
                images.append(fn)
                break
    print("items kept:", len(table["items"]), "images:", len(images))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
