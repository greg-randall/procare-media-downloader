# Procare Photo & Video Downloader

A browser console script that downloads every photo and video of your child(ren) from the Procare web app, with the original date in the filename and in the JPEG EXIF data.

## Usage

1. Open the Procare web app in your browser and log in.
2. Press F12 and go to the **Console** tab.
3. Paste the contents of `procare-downloader.js` and press Enter.
4. Leave the tab open. Files are saved through the browser's normal download mechanism.

The script reads your auth token from the page's local storage. If it can't find one, it prompts you to paste it.

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

## Notes

- The photos API reports `{page, per_page, total, photos}` with 30 items per page. The script stops paging once it has collected `total` items.
- The first response from each endpoint logs a `🔬` line showing its top-level fields, which helps if Procare changes the format.
- Your browser may ask to allow multiple downloads the first time.
