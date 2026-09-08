# Contributing

The most useful thing you can contribute is **a `FW_RTC.txt` from a camera that is not a
Roam2**. The Contour+2, ContourGPS, ContourHD and the original Roam all use this file with
different keys, and one real example is enough to add support for a model.
[Open an issue](https://github.com/DillPickleSwimmer/contour-roam-settings/issues) and
attach it. It contains no personal data beyond a camera ID and whatever name you set.

## Adding a camera model

1. Drop the file in `samples/` under a name that identifies the model.
2. Extend `PROFILE_FIELDS` / `GLOBAL_FIELDS` in `src/schema.js`. Take the values from the
   `DATA STRUCTURE` block in the file itself rather than guessing — the firmware documents
   its own accepted values, and different models disagree.
3. Add a round-trip test in `test/format.test.mjs` asserting the new sample survives parse
   and serialize byte for byte.

## Ground rules for the writer

`src/format.js` must never reformat the file. It rewrites only the characters after a key's
colon. It does not add keys, normalise line endings, strip trailing whitespace or reorder
anything. The camera firmware is the consumer here and it is not a tolerant parser.

Two keys are off limits: `UPDATE_FW` triggers a firmware flash, and `CUID` identifies the
hardware. Nothing in this project should ever write them.

## Running things

```bash
node --test                  # tests
python3 -m http.server 8731  # the app
```

No build step, no dependencies. Keep it that way if you can — a static page with no
toolchain is the reason this will still work in ten years, which is more than the original
software managed.
