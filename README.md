# CSELL

Turkish, local-first CS2 item trade journal. Record buys for skins and the wider CS2 item catalog, calculate per-item marketplace fees, track the exact trade-protection unlock timestamp, and compare expected proceeds with the real sale result.

## Features

- Searchable CS2 catalog: skins by wear, cases, capsules, agents, stickers, sticker slabs, charms, music kits, patches, graffiti, collectibles, and keys.
- Local browser storage with no account and no server-side collection of trade records.
- Configurable percentage and fixed fee, applied separately to each item sold.
- Exact unlock timestamp: buy timestamp plus the selected number of full 24-hour periods (8 days by default).
- Unique transaction IDs, editable actual sale prices, date/category/status filters, realized and forecast profit reports, CSV export, and JSON backup/restore.
- Scheduled GitHub Actions catalog refresh. The app can also load the matching upstream list directly on first use if a refreshed local file is not available.

## Run locally

Serve this directory over HTTP so IndexedDB and the service worker are available. For example, with Python installed:

```sh
python -m http.server 4173
```

Then open `http://localhost:4173`.

## Publish at `csell.haking.tr`

The repository includes a `CNAME` for the requested host. Point the domain DNS records at the static host selected for deployment, enable HTTPS, and publish the repository root as the web root. The scheduled catalog workflow requires GitHub Actions to be enabled and repository contents write permission; its first run will create the compact category files under `data/catalog/`.

This is a static, local-first app. Publishing the site does not upload or synchronize visitors' trade history between devices. Users can move their data with the JSON backup and restore controls.

## Item data attribution

Catalog entries and item image references are based on [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API) and [ByMykel/counter-strike-image-tracker](https://github.com/ByMykel/counter-strike-image-tracker). See [ATTRIBUTIONS.md](./ATTRIBUTIONS.md).
