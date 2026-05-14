# Silvarkicks Store

One-of-one pre-loved kicks. Sneakers, boots, loafers, sandals and more. Worldwide delivery.

Live: [@silvarkicks_store1 on Instagram](https://www.instagram.com/silvarkicks_store1/)
WhatsApp orders: +254 746 262 400

## Stack

Plain static site — HTML, CSS, JavaScript. No build step, no framework.

```
index.html      Public catalog (dark theme, lime accent)
admin.html      Owner panel (password-protected, see admin.js)
main.js         Gallery + filters + wishlist + WhatsApp deeplinks
admin.js        CRUD on items + IG quick-add + sales dashboard + WA marketing
styles.css      Dark mode + lime accent, 4:5 product cards
worker/         Cloudflare Worker that stores items + images in KV
images/         Logo, favicons, OG share
workflows/      Internal SOPs (catalog onboarding, IG import)
```

## Run locally

```bash
python -m http.server 8765
```

Then open [http://localhost:8765](http://localhost:8765).

## Deploy

Cloudflare Pages (recommended). Worker already deployed at
`https://silvarkicks-api.stawisystems.workers.dev`.

```bash
# from this folder
$env:CLOUDFLARE_ACCOUNT_ID = "58685495706b973821d77208248c66fc"
npx wrangler pages deploy . --project-name=silvarkicks --branch=master --commit-dirty=true
```

## Owner workflow

1. Open `/admin.html`, log in with the password baked into `admin.js`.
2. **Add a new pair**: paste an Instagram post URL in the Quick-add panel — image, extras and caption auto-fill. Set the size and price. Save.
3. **Mark sold**: click Sell on the item card, pick the size and qty, optionally capture buyer name + phone. The dashboard tracks today/week/month/all-time revenue.
4. **WhatsApp Marketing**: pick items + recipients (past buyers auto-listed) and send personalised WA messages, one tab per buyer.

## Credits

Design and build: [Essence Automations](https://essenceautomations.com/websites)
