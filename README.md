# Procare Photo & Video Downloader

A browser console script that downloads every photo and video of your kiddos from the Procare web app, with the original date in the filename and in the JPEG EXIF data.

## Usage

1. Open the Procare web app in your browser and log in.
2. Press F12 and go to the **Console** tab.
3. Paste the contents of `procare-downloader.js` and press Enter.
4. Leave the tab open. Files are saved through the browser's normal download mechanism.

## What it does

- Finds your children, then collects photos, videos and media attached to daily activities.
- Scans photos month by month, newest to oldest, and stops after 6 months in a row with no photos (once it has found some).
- Follows pagination until it has every item for each month.
- Deduplicates media by URL.
- Names files `Child_YYYY-MM-DD_HH-MM-SS_N.ext` and writes the date into JPEG EXIF (via piexifjs, loaded from cdnjs when needed).
- Retries temporary failures, and keeps going if a single request fails.

## Configuration

Set at the top of the script.

| Setting | Default | Meaning |
| --- | --- | --- |
| `DEBUG` | `false` | `true` scans only the current month and downloads the last 30 days |
| `START_YEAR` | `2020` | Oldest year to scan when `DEBUG` is off |
| `MAX_RETRIES` | `3` | Attempts per request |
| `API_DELAY_MS` | `1250` | Minimum gap between any two requests |
| `PHOTO_DELAY_MS` | `1750` | Minimum gap for the photo scan and file downloads |
| `RATE_LIMIT_DELAY_MS` | `60000` | Wait before retrying after an HTTP 429 |
| `EMPTY_MONTHS_TO_STOP` | `6` | Consecutive empty months before the photo scan stops |

## How long a run takes

The script is deliberately slow to stay under Procare's rate limit.

- Each photo or video download takes about 1.75 seconds.
- Each page of photos scanned takes about 1.75 seconds, and a page holds 30 photos.
- Each page of videos or daily activities scanned takes about 1.25 seconds, also 30 per page.

For example, a child with 1,000 photos over two years:

| Phase | Work | Time |
| --- | --- | --- |
| Scan photos | about 30 months (including the 6 empty ones that stop the scan) plus a few extra pages, so about 40 pages | 1 to 2 minutes |
| Download | 1,000 files x 1.75 seconds | about 29 minutes |
| **Total** | | **about 30 minutes** |

Add 1.25 seconds for every 30 daily activities on the account. The console shows the real `total` for each on its `🔬` line. These are calculated from the delay settings, not measured. Every HTTP 429 adds a 60 second wait, and each extra child repeats the scan and downloads.

## Notes

- The photos API reports `{page, per_page, total, photos}` with 30 items per page. The script stops paging once it has collected `total` items.
- The first response from each endpoint logs a `🔬` line showing its top-level fields, which helps if Procare changes the format.
- Your browser may ask to allow multiple downloads the first time.

## Procare API notes

[README-PROCARE-API.md](README-PROCARE-API.md) documents the internal Procare web API the script uses: where the auth token lives, the endpoints for children, photos, videos and daily activities, date filters, pagination, and media URL handling. It is reverse engineered from the web app, not official documentation, so details may change and some are marked there as unverified.

## License

MIT. See [LICENSE](LICENSE).
