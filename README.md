# Pinstripe Creator

Design fabric pinstripe patterns: the stripe sequence, the rapport (repeat) calculation
kept within the fabric model's maximum, and a preview of one repeat or of the repeated fabric
(vertical, horizontal, check, or diagonal at 30°, 45° or 60°).

- **Company colors**: click a color square to choose from the solid colors exported from Centric
  (`colors.js`), with search by code, name or Pantone and a season filter.
- **Colorways**: the same stripes in up to 8 color versions.
- **Pajama set**: a flat sketch of the top (T-shirt or button-front, short or long sleeves) and the
  bottom (shorts or long pants), with the stripes on the top, the bottom or both, drawn to scale.
- **Save as PDF**: an A4 spec sheet with optional order details, the fabric at actual size,
  every colorway and the pajama set.

Plain HTML and JavaScript, no build step: open `index.html` in a browser.

| File | What it is |
|---|---|
| `index.html` | The page and its look |
| `app.js` | How it works |
| `fabrics.js` | Fabric models and their maximum rapport. Edit this list to add or change a fabric |
| `colors.js` | Company solid colors from Centric (rebuilt from a new Centric export when the list changes) |

Designs are kept in the browser under **My designs**. **Download backup** and **Restore from backup**
(in the same window) keep them safe and move them to another computer.

The Pantone field is a label only: the color shown is the one set with the swatch or hex code.

**Website:** https://digstraightthrough.github.io/pinstripe-creator/

When publishing a change, update the `?v=` number on the script lines at the bottom of `index.html`.
Browsers keep the files for 10 minutes; the new number makes them fetch the new program with the new page.

Visits are counted with GoatCounter (same account as the other digstraightthrough sites): no cookies,
nothing that identifies a visitor, and only the page path is sent. Three actions are counted
anonymously as `pc-save`, `pc-pdf` and `pc-pajama-view`. Designs are never sent anywhere.
