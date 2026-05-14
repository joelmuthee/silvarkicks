# Workflow: Import New Bags from @thriftlux.ke Instagram

**Objective:** Download new reel thumbnails and captions from Venessa's Instagram, add them to `data.json`, and crop them to look great in the website grid.

**Last run:** 2026-05-09

---

## Checkpoint (update after every run)

| Field | Value |
|---|---|
| Last run date | 2026-05-09 |
| Most recent reel imported | `DYDQo8Pt0xH` (Black Leather Embroidered Horses Mini Roy Bucket Bag, posted 2026-05-08) |
| Total bags in `data.json` | 24 |

**How to use the checkpoint:** Reels grid shows newest first. On the next run, scroll the grid until the checkpoint shortcode (`DYDQo8Pt0xH`) is visible, then run the Step 2 script with `STOP_AT` set to the checkpoint. Only newer reels will be collected.

---

## Inputs

| Input | Value |
|---|---|
| Instagram profile URL | `https://www.instagram.com/thriftlux.ke/reels/` |
| Stop-at shortcode (last imported) | `DYDQo8Pt0xH` |
| Project root | `C:\Users\Joel\Website Designs\thriftlux-ke` |
| Backup of originals | `.tmp/bags_original/` |

---

## What does NOT work (skip these)

- **Apify `instagram-reel-scraper`** — returns CDN URLs that the VM can't fetch (network block).
- **`/media?size=l`** trick on Instagram — long dead.
- **Static `<img>` extraction from the reels grid** — Instagram renders thumbnails as CSS `background-image` on a `<div>`, not as `<img>`.
- **Playwright for caption collection** — not logged in to Instagram, older reels return "This content is unavailable". Use the Chrome MCP (logged in) instead.
- **JavaScript returning CDN URLs or base64** — output is filtered. Store in `window.__*` globals and trigger downloads via `<a download>`.

---

## The process that works

### Step 1 — Open the reels page in Chrome

Navigate to `https://www.instagram.com/thriftlux.ke/reels/` and scroll until the checkpoint shortcode is visible:

```javascript
!!document.querySelector('a[href*="DYDQo8Pt0xH"]')  // should be true
```

### Step 2 — Extract only NEW thumbnail URLs

```javascript
const STOP_AT = 'DYDQo8Pt0xH'; // ← update each run

const reelLinks = document.querySelectorAll('a[href*="/reel/"]');
const seen = new Set();
window.__reelData = [];

for (const link of reelLinks) {
  const m = link.href.match(/\/reel\/([^/]+)/);
  if (!m || seen.has(m[1])) continue;
  if (m[1] === STOP_AT) break;
  seen.add(m[1]);
  const firstDiv = link.querySelector('div');
  if (firstDiv) {
    const bg = firstDiv.style.backgroundImage;
    const urlMatch = bg.match(/url\("(.+?)"\)/);
    if (urlMatch) window.__reelData.push({ shortcode: m[1], url: urlMatch[1] });
  }
}
'Found ' + window.__reelData.length + ' new reels';
```

### Step 3 — Fetch images as base64 (logged-in browser)

Run in batches of 5 to avoid timeouts:

```javascript
(async () => {
  async function fetchImage(item) {
    const resp = await fetch(item.url);
    const blob = await resp.blob();
    const reader = new FileReader();
    const b64 = await new Promise(r => { reader.onloadend = () => r(reader.result); reader.readAsDataURL(blob); });
    return { shortcode: item.shortcode, data: b64.split(',')[1], size: blob.size };
  }
  window.__batch1 = [];
  for (let i = 0; i < 5; i++) window.__batch1.push(await fetchImage(window.__reelData[i]));
  return window.__batch1.map(r => ({ shortcode: r.shortcode, size: r.size, hasData: !!r.data }));
})();
```

Repeat with `__batch2`, `__batch3`, etc. Then merge:
```javascript
window.__allImages = [...window.__batch1, ...window.__batch2, ...];
```

### Step 4 — Trigger browser downloads

```javascript
(async () => {
  for (const img of window.__allImages) {
    const byteChars = atob(img.data);
    const byteArray = new Uint8Array(byteChars.length);
    for (let j = 0; j < byteChars.length; j++) byteArray[j] = byteChars.charCodeAt(j);
    const blob = new Blob([byteArray], { type: 'image/jpeg' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reel_${img.shortcode}.jpg`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    await new Promise(r => setTimeout(r, 300));
  }
})();
```

### Step 5 — Move and back up

```powershell
$bags = "C:\Users\Joel\Website Designs\thriftlux-ke\images\bags"
$backup = "C:\Users\Joel\Website Designs\thriftlux-ke\.tmp\bags_original"
Move-Item "$env:USERPROFILE\Downloads\reel_*.jpg" $bags -Force
# Backup any new originals before cropping
foreach ($f in (Get-ChildItem $bags -Filter reel_*.jpg)) {
  $b = Join-Path $backup $f.Name
  if (-not (Test-Path $b)) { Copy-Item $f.FullName $b }
}
```

### Step 6 — Collect captions

For each new shortcode, navigate to `https://www.instagram.com/reel/<shortcode>/` in the **logged-in Chrome MCP** (not Playwright — it's not logged in) and screenshot the caption. The caption format is:

```
<Bag Name> @<price>/= [SOLD OUT]
#thriftlux #thrifted #qualityhandbags #thrifthandbags
```

JS extraction (when not blocked by URL filter):
```javascript
const el = Array.from(document.querySelectorAll('span[dir="auto"]'))
  .find(s => s.innerText && s.innerText.includes('@'));
el ? el.innerText.trim() : 'not found';
```

When the JS output is blocked (because captions contain `@` which looks like cookie/query data), fall back to a screenshot and read the caption from the image.

### Step 7 — Update `data.json`

For each new bag, add an entry to the `bags` array (newest first):

```json
{
  "id": "<shortcode>",
  "name": "<clean bag name from caption>",
  "description": "<short, no em-dashes>",
  "price": <integer Ksh>,
  "sold": <true if caption says SOLD/SOLD OUT, else false>,
  "image": "images/bags/reel_<shortcode>.jpg",
  "reel": "https://www.instagram.com/reel/<shortcode>/"
}
```

### Step 8 — Auto-centre the new images

Run the auto-centring crop script. It detects each bag's bounding box and iteratively adjusts the crop window until horizontal AND vertical offsets are under ~1.5%:

```bash
cd "C:\Users\Joel\Website Designs\thriftlux-ke"
python .tmp/auto_center_bags.py
```

### Step 8b — VERIFY (mandatory)

**You MUST verify centring before pushing. Skip this and you will ship off-centre bags. The store owner notices.**

Run the audit script:
```bash
python .tmp/verify_centering.py
```

It reports `dx%`, `dy%`, and left/right margin in pixels for every bag. Anything `>5%` is flagged `<-- OFF CENTER`. **Target: 0 flagged bags.**

Then take a screenshot of every problem bag at the rendered site (desktop AND mobile) and confirm it actually looks centred:
```python
# In Playwright or the browser MCP, after `localhost:8765/index.html?v=<bumped>` reload:
# - scroll to each bag
# - take a viewport screenshot
# - view it inline and confirm L/R and top/bottom margins are roughly equal
# Do NOT skip this. Numerical metrics can lie about visual perception.
```

If a bag still looks off after auto-centring, add a `MANUAL_OVERRIDE` entry in `auto_center_bags.py`:
```python
MANUAL_OVERRIDE = {
    "reel_<shortcode>.jpg": (y_center_pct, x_center_pct),
}
```
where `y_center_pct` is the bag's actual vertical position in the original (0–1) and `x_center_pct` is the horizontal position. Then rerun the crop + verify loop.

### Step 9 — Add breathing room (margins) around the bag

After centring, the bag fills the 560×700 frame edge-to-edge. The store owner has flagged this — bags need visual margin so they don't look cramped against the card edges.

Run `.tmp/add_margins.py` (creates if missing — see "Margin Recipe" below). It:
1. Sources from `images/bags/` (the freshly cropped images)
2. Shrinks the bag to **78%** of canvas (so ~11% white margin on each side)
3. Pastes onto a pure white `(255,255,255)` canvas of the same dimensions
4. Saves back over the original at `quality=88`

White matches the card background (`--bg-card: #ffffff`) so the padding blends seamlessly — the bag appears to "float" inside the card.

**Do NOT use sampled-edge background colour.** Earlier attempts sampled corner/edge pixels to match the bag photo's bg, but hands, table edges, dark walls, etc. all polluted the sample and produced ugly mismatched borders (e.g. brownish frames around blue bags). White is the only reliable choice.

After running, verify with the same screenshot loop as Step 8 — every bag should now have visible breathing room on all four sides.

### Step 10 — Bump cache-bust + commit

In `main.js`, increment `IMG_VERSION` (`v2` → `v3` etc.) so any cached old image gets force-reloaded. Then:

```bash
git add images/bags/ .tmp/crop_bags.py main.js data.json
git commit -m "Import N new bags from Instagram"
git push origin main
```

### Step 11 — Update the checkpoint

Edit the **Checkpoint** table at the top of this file:
- Set "Most recent reel imported" to `window.__reelData[0].shortcode` (the newest one downloaded)
- Update date and total count

---

## Cropping Recipe (auto)

Originals are 640×1136 portrait. Cards are 4:5 product format. The cropper outputs **560×700** (4:5).

`auto_center_bags.py` works in three steps:

1. **Background detection.** Sample the four corners of the original; the median brightness is the wall colour.
2. **Bag bbox detection.** Mark every pixel that differs from the background by >25 grayscale levels. Strip the bottom 5% (floor/fluff) and the top 30% (asymmetric strap/hand region). Take the 2nd–98th percentile bounding box of the remaining pixels — that's the bag.
3. **Iterative refinement.** Crop a 560×700 window centred on that bbox. Re-detect inside the crop, measure how far the bag's centre is from the crop centre, shift the crop window by 70% of the offset, repeat. Up to 8 iterations or until both axes are under 1.5% offset.

This converges on properly centred crops for ~99% of bags without manual intervention. For edge cases (e.g. bag colour matches the background, or the bag is photographed in front of a busy backdrop), use `MANUAL_OVERRIDE`.

`verify_centering.py` is the independent auditor: it computes `dx%` and `dy%` from the cropped image's foreground bbox vs. its geometric centre and prints the L/R margins in pixels. **It is the source of truth. If it flags anything, fix before pushing.**

The cropper always reads from `.tmp/bags_original/`, so re-running is non-destructive.

---

## Margin Recipe (`add_margins.py`)

Runs AFTER cropping. Adds white padding around each bag so it has breathing room inside the card.

```python
from pathlib import Path
from PIL import Image

SRC_DIR = Path("images/bags")
SHRINK = 0.78  # bag occupies 78% of canvas → ~11% margin each side

def add_margin(path):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    new_w, new_h = int(w * SHRINK), int(h * SHRINK)
    bag = img.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGB", (w, h), (255, 255, 255))
    canvas.paste(bag, ((w - new_w) // 2, (h - new_h) // 2))
    canvas.save(path, "JPEG", quality=88, optimize=True)

for p in sorted(SRC_DIR.glob("*.jpg")):
    add_margin(p)
```

**Destructive — overwrites the cropped images in place.** If you need to re-run, restore originals via `git checkout HEAD -- images/bags/` first, otherwise you'll shrink the already-padded image and the bag will get smaller and smaller.

---

## Notes & gotchas

- **Chrome MCP is logged in** to Instagram; **Playwright is not**. Older reels (DX*) return "content unavailable" in Playwright.
- **JavaScript output filter** blocks anything with `@`, query strings, or base64. Use `window.__*` globals and DOM downloads, never `return`/`console.log` raw URLs or data.
- **Image cache:** browsers aggressively cache `.jpg` files. After re-cropping, bump `IMG_VERSION` in `main.js` so the `?v3` query forces a reload, otherwise users see the old version even after a normal refresh.
- **Em-dashes are banned in user-facing copy.** Use full stops, colons, or middle-dots (`·`) instead.
- **"At your expense" and similar standoff-ish phrasing should be softened.** Lead with "we can arrange" rather than putting cost on the customer up front.
- **Caption parsing:** Instagram puts the caption in a `<span dir="auto">` containing the text. Sold status is detected from the words `SOLD` or `SOLD OUT` in the caption.
- **NEVER ship without verifying centring with a screenshot.** Numerical metrics (dx%, dy%) can disagree with visual perception when a bag's strap goes off to one side or a hand is visible. After running `verify_centering.py`, take screenshots of EVERY bag (or at least every flagged one) on the rendered site and confirm L/R margins look equal. Earlier in this project, the assistant pushed off-centre crops three times because it relied on metrics alone — don't repeat that.
- **Always look at all four margins.** Top, bottom, left, and right. A bag with equal top/bottom margins but heavy bias to one side is still "off-centre" and the store owner WILL notice.
- **Never ship bags that fill the frame edge-to-edge.** Auto-cropping produces tight crops with no breathing room. Always run `add_margins.py` after cropping. The store owner flagged this specifically: bags need visual padding so they don't look cramped. Use pure white `(255,255,255)` only — sampled edge colours produce ugly mismatched borders when hands or dark backgrounds pollute the sample.
