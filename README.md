# Contour Roam 2 settings

A small web page for changing the settings on a **ContourROAM2** action camera.

Contour shut down and took [Storyteller](https://web.archive.org/web/2016/http://contour.com/storyteller)
with it, which left a working camera with no way to change its resolution, mic level or
white balance. The settings still live in a plain text file on the camera's memory card,
so this replaces Storyteller's settings screen with a page that edits that file for you.

**→ [Open the app](https://dillpickleswimmer.github.io/contour-roam-settings/)**

No install, no account, no server. The page is static and the file never leaves your
computer — the browser reads and writes it locally.

## Using it

1. Plug the camera into USB with the record slider **back** (not in the ON position).
   The battery LED turns red and the camera mounts as a drive.
2. Open the app and click **Connect camera**, then pick the camera's drive.
3. Change what you want and click **Save to camera**.
4. Eject the drive, unplug the cable, then press and release the status button.
   The camera beeps, turns off, and comes back with the new settings.

Step 4 is not optional. The camera only reads the file on a fresh start.

### Browser support

| Browser | What happens |
| --- | --- |
| Chrome, Edge, Brave, Arc, Opera | Saves straight to the camera |
| Safari, Firefox | Edit here, then copy the downloaded `FW_RTC.txt` back onto the camera yourself |

The difference is the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API),
which only Chromium browsers implement. Everything else works the same either way.

### If the file is hidden

`FW_RTC.txt` is often flagged hidden, so it will not show up in a file dialog. That is why
the app asks for the **drive** rather than the file — it finds the file itself. If you do
need to see it in a picker, press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>.</kbd> on macOS or turn on
hidden files in Windows Explorer's View menu.

## What you can change

Values come from the `DATA STRUCTURE` block the firmware writes into `FW_RTC.txt`, so this
is the camera describing itself.

| Setting | Key | Values |
| --- | --- | --- |
| Resolution | `1RES` | `A` 1080p · `B` 960p · `C` 720p · `D` 720p at double rate · `P/n` 5MP stills every n seconds (1, 3, 5, 10, 30, 60) |
| Bitrate | `1BR` | `H` high, `L` low |
| Exposure | `1EV` | −4 to 4 |
| Metering | `1AE` | `C` center, `A` average, `S` spot |
| White balance | `1AWB` | `0` auto, `1` 2800K, `2` 4000K, `3` 5000K, `4` 6500K, `5` 7500K, `6` 9000K, `7` 10000K |
| Sharpness | `1SHRP` | 1 to 5 |
| Contrast | `1CTST` | 1 to 255 (factory default 62) |
| Mic level | `1MIC` | 0 to 42 dB |
| Alignment lasers | `1LSR` | `0` off, `1` on |
| Status LEDs | `1LED` | `0` off, `1` on |
| Beeps | `1SILENT` | `0` on, `1` off — note this one is inverted |
| Frame rate | `FPS` | `25` PAL, `30` NTSC |
| Camera name | `CAMERA NAME` | up to 20 characters |
| Note | `DATA` | up to 100 characters |
| Clock | `DT` | `YYYY/MM/DD hh:mm:ss` |

`FPS` changes what the resolution letters mean: `D` is 720p50 on PAL and 720p60 on NTSC.
The app relabels the dropdown when you switch, so you always see the real frame rate.

### Two keys this app will not touch

- **`UPDATE_FW`** arms a firmware flash from a `.bin` on the card at next boot. Nothing here
  ever writes it. If your file already has `UPDATE_FW:Y`, the app warns you.
- **`CUID`** and the `FW version` lines identify your hardware and are left alone.

The one key the app *does* set on your behalf is **`UPDATE:Y`**, which is what tells the
camera to read the file. Storyteller did the same thing. Without it, edits are ignored.

## How the file is written

The camera's firmware is not forgiving about this file, so saving is deliberately
conservative. Only the characters after a key's colon are replaced. CRLF line endings,
indentation, blank lines, the documentation block, unknown keys and even odd spacing all
survive a round trip byte for byte. Loading and saving without changing anything produces
an identical file, and that is enforced by a test.

## Other Contour cameras

Only the Roam2 is supported and tested today. The Contour+2, ContourGPS and ContourHD use
the same file with two switch positions (`1…` and `2…`, or `SW HI` / `SW LO`) and a
slightly different set of keys, so support is mostly a matter of extending
[`src/schema.js`](src/schema.js). **If you have one of those cameras, please
[open an issue](https://github.com/DillPickleSwimmer/contour-roam-settings/issues) with
your `FW_RTC.txt` attached** — that file is all it takes to add a model.

## Development

No build step and no dependencies. It is plain ES modules.

```bash
python3 -m http.server 8731   # then open http://localhost:8731
```

```bash
node --test
```

- `src/format.js` — parses and re-serializes `FW_RTC.txt`, preserving bytes
- `src/schema.js` — what every key means and which values are legal
- `src/camera.js` — picking, reading and writing the file
- `src/ui.js` — builds one control per field
- `src/app.js` — wiring
- `samples/` — a real Roam2 file, used by the tests

## Credits

The settings file format was pieced together by the Contour owner community after the
company folded, particularly the notes on
[mtbr.com](https://www.mtbr.com/threads/turn-your-contour-roam-into-a-contour-roam-2.858497/)
and [Woodlandforum](https://woodlandforum.com/board/index.php/Thread/35319-Tutorial-Contour-Roam2-Einstellungen/).

## Disclaimer

Not affiliated with, endorsed by, or connected to Contour, Inc. Editing your camera's
settings file is something you do at your own risk. Keep a backup copy of the original
`FW_RTC.txt`.

MIT licensed.
