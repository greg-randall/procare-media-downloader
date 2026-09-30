# Procare Internal API Reverse Engineering

This guide explains how to use Procare's internal API to programmatically fetch a child's photos, videos, and media attached to daily activities, along with their metadata.

## 1. Authentication

Procare uses a Bearer token for authentication. The token can be extracted from browser local storage while logged into the Procare web application.

### Extracting the Token

1. Open Developer Tools (F12) in your browser on the Procare website.
2. Go to the **Application** tab -> **Local Storage**.
3. Look for the key `persist:kinderlime` or `kinderlime-user`.
4. The token may be found in the parsed JSON under properties such as:

   * `auth_token`
   * `currentUser.data.auth_token`

The exact local storage structure may vary.

### Headers

Requests to the API should include:

```json
{
  "Authorization": "Bearer <YOUR_AUTH_TOKEN>",
  "Accept": "application/json",
  "X-APP-ID": "PCO",
  "X-CLIENT-NAME": "Web"
}
```

An `X-SITE-ID` header such as:

```text
X-SITE-ID: PCO:SITE:<school_id>
```

may also appear in requests from the web application. It does not appear to be required for the requests tested so far.

## 2. API Base URL

The base URL is:

```text
https://api-school.procareconnect.com/api/web
```

## 3. API Endpoints

### A. Get Children

Before fetching media, get the child's internal `kid_id`.

**Endpoint:**

```http
GET /parent/kids
```

The response contains the children's information, including an `id` and usually a `name` or `first_name`.

Example:

```text
https://api-school.procareconnect.com/api/web/parent/kids
```

The `id` returned for the child is used as `kid_id` when requesting media.

### B. Fetch Photos

**Endpoint:**

```http
GET /parent/photos/
```

Photos are returned through a paginated API.

The photo endpoint accepts:

* `page`: Page number, starting at `1`
* `kid_id`: The child's ID
* `filters[photo][datetime_from]`: Optional start date
* `filters[photo][datetime_to]`: Optional end date

### Photo Date Filters

The date filters should be sent as **date-only strings**:

```text
YYYY-MM-DD
```

For example:

```text
filters[photo][datetime_from]=2026-09-01
filters[photo][datetime_to]=2026-09-30
```

Do not send the time as part of these values unless further testing shows that the API accepts it.

During testing, a request using:

```text
filters[photo][datetime_from]=2026-09-01 00:00
filters[photo][datetime_to]=2026-09-31 23:59
```

returned HTTP `422` with:

```json
{
  "error": "Both filters[photo][datetime_from] and filters[photo][datetime_to] must be valid datetime formatted strings"
}
```

There were two issues with that request:

1. September has only 30 days, so `2026-09-31` is invalid.
2. The documented API examples use date-only values.

The safest approach is to calculate the final day of each month rather than hard-coding it.

For example:

```javascript
const lastDay = new Date(year, month, 0).getDate();
```

where `month` is the numeric month from `1` through `12`.

### Example Photo Request

```bash
curl -X GET "https://api-school.procareconnect.com/api/web/parent/photos/?page=1&kid_id=12345&filters[photo][datetime_from]=2026-09-01&filters[photo][datetime_to]=2026-09-30" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Accept: application/json" \
  -H "X-APP-ID: PCO" \
  -H "X-CLIENT-NAME: Web"
```

### Photo Response

A photo response contains an array of photo objects plus pagination information.

A photo object may contain:

* `id`: Unique media ID
* `main_url`: URL for the image
* `url`: May also contain a usable media URL
* `created_at`: Creation timestamp
* `captured_at`: Capture timestamp

The downloader should prefer:

```javascript
photo.main_url || photo.url
```

for the media URL, and:

```javascript
photo.created_at || photo.captured_at
```

for the timestamp.

## 4. Fetch Videos

**Endpoint:**

```http
GET /parent/videos/
```

The videos endpoint is paginated and uses the child's `kid_id`.

Example:

```text
https://api-school.procareconnect.com/api/web/parent/videos/?page=1&kid_id=12345
```

Video objects may contain:

* `id`
* `video_file_url`
* `main_url`
* `url`
* `created_at`
* `captured_at`

The downloader should prefer:

```javascript
video.video_file_url ||
video.main_url ||
video.url
```

for the media URL.

For the timestamp:

```javascript
video.created_at ||
video.captured_at
```

The current downloader does not apply a date filter to the video endpoint. If date filtering for videos is needed, the accepted filter format should be verified separately rather than assuming the photo filter behavior applies.

## 5. Fetch Daily Activities

Some media is attached to daily activities rather than appearing only in the main photo or video gallery.

**Endpoint:**

```http
GET /parent/daily_activities/
```

The request uses:

* `page`
* `kid_id`

Example:

```text
https://api-school.procareconnect.com/api/web/parent/daily_activities/?page=1&kid_id=12345
```

The response contains an array of `daily_activities`.

Each activity may contain an:

```javascript
activity.activiable
```

or:

```javascript
activity.activable
```

object.

The spelling may vary, so code should check both.

That object can contain a single media URL:

```javascript
activiable.main_url
activiable.video_file_url
activiable.url
```

It can also contain arrays such as:

```javascript
activiable.photos
activiable.videos
```

Individual items in those arrays may use:

```javascript
media.main_url
media.video_file_url
media.url
```

Daily activity media should use the **media URL itself as the deduplication key**. This prevents multiple media items attached to the same activity from overwriting one another.

## 6. Pagination

The endpoints are paginated.

The basic process is:

1. Start with `page=1`.
2. Parse the JSON response.
3. Extract the media array.
4. Process the returned items.
5. Check for `next_page`.
6. If `next_page` exists and is greater than the current page, request that page.
7. Continue until there is no next page.

Pagination information may appear directly on the response:

```javascript
data.next_page
```

or under:

```javascript
data.meta.next_page
```

A downloader should check both.

The API may also return an empty array when there are no items on a page. This should be treated as the end of the results.

## 7. Media Deduplication

Photos, videos, and daily activities can expose the same media through more than one endpoint.

The downloader therefore keeps a map keyed by the media URL:

```javascript
allMediaMap.set(url, media);
```

After all three sources have been queried:

```javascript
const deduplicatedMedia =
    Array.from(allMediaMap.values());
```

This means the same media file should only be downloaded once even if it appears in both the photo gallery and a daily activity.

## 8. Media URLs

The URLs returned by Procare are often direct or pre-signed media URLs, commonly hosted through Amazon S3 or another storage service.

These URLs may expire.

For that reason, the downloader should fetch the media reasonably soon after receiving the API response rather than saving the URLs for later use.

The API response provides the URL needed to retrieve the actual media file. The downloader does not need to construct the storage URL itself.

## 9. Download Metadata

The downloader uses the Procare timestamp to create filenames.

For example:

```text
Frey_2026-09-25_09-40-02_1.jpg
```

The timestamp is taken from:

```javascript
created_at || captured_at
```

when available.

For JPEG files, the downloader also attempts to write the Procare timestamp into the EXIF metadata:

* `DateTimeOriginal`
* `DateTimeDigitized`
* `DateTime`

If EXIF processing fails, the original image is saved instead.

EXIF modification is optional and does not affect downloading the original media.

## 10. Error Handling

The API can return errors for malformed requests.

For example, invalid date ranges can produce:

```text
HTTP 422 Unprocessable Content
```

The downloader should not assume that every HTTP error is temporary.

A useful approach is:

* Retry temporary server errors.
* Retry failed network requests.
* Do not repeatedly retry obvious `400`, `401`, `403`, `404`, or `422` errors.
* Log the failed request.
* Continue processing other media where possible.

This is especially useful when downloading a large archive. One bad media URL should not stop the entire download.

## 11. Current Downloader Workflow

The current downloader follows this general process:

```text
Authenticate
    |
    v
Get children
    |
    v
Get kid_id
    |
    +-------------------+
    |                   |
    v                   v
Get photos          Get videos
    |                   |
    +---------+---------+
              |
              v
      Get daily activities
              |
              v
       Extract media URLs
              |
              v
       Deduplicate by URL
              |
              v
       Optional date filter
              |
              v
          Download
              |
              v
       Add JPEG EXIF data
```

For a full historical download, the downloader queries photos month by month. This avoids making one extremely large photo request and reduces the chance of gateway timeouts.

The current debug mode instead queries the current month and then limits the final download list to media from the previous 30 days.

## 12. Known API Details and Open Questions

The following behavior has been observed directly while testing the API:

* The base API is `https://api-school.procareconnect.com/api/web`.
* Authentication uses a Bearer token.
* `X-APP-ID: PCO` and `X-CLIENT-NAME: Web` are used by the web application.
* `/parent/kids` provides the child ID.
* `/parent/photos/` accepts `kid_id`.
* Photo date filters use `filters[photo][datetime_from]` and `filters[photo][datetime_to]`.
* Month boundaries must use real calendar dates.
* `/parent/videos/` returns video media URLs.
* `/parent/daily_activities/` can contain additional photos or videos.
* Pagination uses `next_page`, either directly or under `meta`.
* The same media can appear through multiple API sources, so URL-based deduplication is useful.
* Media URLs may expire.

Some details have **not** been fully verified and should not be assumed:

* The exact video date-filter syntax and whether it behaves exactly like the photo filters.
* The exact meaning of every pagination field returned by the API.
* Whether `X-SITE-ID` is required for all Procare accounts or endpoints.
* How long individual signed media URLs remain valid.
* Whether all historical media is available through these current API endpoints.

These should be tested against the actual Procare account before relying on them for a complete archive.