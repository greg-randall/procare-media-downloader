# Procare Internal Web API

Notes on how Procare's internal web API works, for fetching a child's photos, videos, and media attached to daily activities.

This is reverse engineered from the Procare web app. It is not official documentation and it can change without notice. Behavior seen directly in testing is stated as fact. Anything not verified is listed at the end.

## 1. Authentication

Procare uses a Bearer token. The web app keeps it in browser local storage while you are logged in.

### Finding the token

1. Open Developer Tools (F12) on the Procare website.
2. Go to the **Application** tab -> **Local Storage**.
3. Look for the key `persist:kinderlime` or `kinderlime-user`.
4. The token is in the parsed JSON, under a property such as:

   * `auth_token`
   * `currentUser.data.auth_token`

The exact local storage structure may vary.

### Headers

Requests to the API include:

```json
{
  "Authorization": "Bearer <YOUR_AUTH_TOKEN>",
  "Accept": "application/json",
  "X-APP-ID": "PCO",
  "X-CLIENT-NAME": "Web"
}
```

The web app also sends other headers, such as `requested-from` and `X-SITE-ID: PCO:SITE:<school_id>`. They are not needed for the requests tested so far.

## 2. Base URL

```text
https://api-school.procareconnect.com/api/web
```

## 3. Endpoints

### A. Children

```http
GET /parent/kids
```

Returns the children on the account. Each has an `id` and usually a `name` or `first_name`. The `id` is the `kid_id` used by the other endpoints.

### B. Photos

```http
GET /parent/photos/
```

Query parameters:

* `page`: page number, starting at `1`
* `kid_id`: the child's ID. The web app's own photo requests do not send it, but the API accepts it.
* `filters[photo][datetime_from]`: optional start of the date range
* `filters[photo][datetime_to]`: optional end of the date range

Example:

```bash
curl -X GET "https://api-school.procareconnect.com/api/web/parent/photos/?page=1&kid_id=12345&filters[photo][datetime_from]=2026-09-01&filters[photo][datetime_to]=2026-09-30" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Accept: application/json" \
  -H "X-APP-ID: PCO" \
  -H "X-CLIENT-NAME: Web"
```

#### Date filters

Two value formats are accepted:

* Date only: `2026-09-01`
* Date and time: `2026-07-01 00:00` and `2026-07-31 23:59`, which is what the web app sends

The end date must be a real calendar date. A request with `datetime_to=2026-09-31 23:59` returned HTTP `422`:

```json
{
  "error": "Both filters[photo][datetime_from] and filters[photo][datetime_to] must be valid datetime formatted strings"
}
```

September has 30 days, so `2026-09-31` is not a valid date, which is the likely cause. The web app sends the same date-and-time format, so the time part is not the problem.

#### Response

```json
{
  "page": 1,
  "per_page": 30,
  "total": 50,
  "photos": []
}
```

`total` is the number of photos matching the filters across all pages. There is no `next_page` field. See the pagination section.

A photo object may contain:

* `id`: unique media ID
* `main_url`: URL of the image
* `url`: may also hold a usable media URL
* `created_at`: creation timestamp
* `captured_at`: capture timestamp

### C. Videos

```http
GET /parent/videos/?page=1&kid_id=12345
```

A video object may contain:

* `id`
* `video_file_url`: URL of the video file
* `main_url`
* `url`
* `created_at`
* `captured_at`

Date filtering on this endpoint has not been tested.

### D. Daily activities

Some media is attached to daily activities and does not appear only in the photo or video galleries.

```http
GET /parent/daily_activities/?page=1&kid_id=12345
```

The response contains a `daily_activities` array. Each activity may have an `activiable` object, or `activable`. Both spellings occur, so check both.

That object can hold a single media URL in `main_url`, `video_file_url` or `url`. It can also hold arrays named `photos` or `videos`, whose items use `main_url`, `video_file_url` or `url`.

Requests tested so far used no date filter. Whether a date filter is accepted has not been tested.

## 4. Pagination

All three list endpoints are paginated, 30 items per page. A month with more than 30 photos spans several pages, and the web app's "click to load more" button requests `page=2`, `page=3` and so on.

For photos, the response reports `page`, `per_page` and `total` and has no `next_page`. Requesting a page past the end returns an empty array, not an error.

This is easy to get wrong: page 1 looks like a complete response, so a client that stops after one page silently loses everything else in the range. To read a whole result set:

1. Request `page=1`.
2. Keep requesting the next page until the number of items collected reaches `total`, or a page comes back empty.
3. If a response has `next_page`, either directly or under `meta`, that value can be used instead.

The shapes of the videos and daily activities responses have not been recorded, so it is not known whether they report `total`. If they don't, the only end signal is an empty page.

## 5. Media URLs

The list endpoints return URLs for the media files, not the files themselves.

* The URLs are pre-signed. Thumbnail URLs seen in the web app came from `private.cdn.procareconnect.com` and carried `Expires`, `Signature` and `Key-Pair-Id` query parameters. Downloading a file needs no `Authorization` header.
* The URLs expire, so fetch the file soon after the API response and don't store URLs for later. The lifetime of full-size media URLs has not been verified.
* The same media file can be returned by more than one endpoint, for example in the photo gallery and again inside a daily activity. The URL itself is a good key for telling duplicates apart.

## 6. Errors and rate limiting

* `422` is returned for invalid parameters, such as a date that doesn't exist. Repeating the same request will not help.
* `400`, `401`, `403` and `404` are also not fixed by retrying the same request.
* `429` (too many requests) was returned after a long run of page requests. The limit is not documented, and it is not known whether it counts per minute or over a longer window. Waiting 60 seconds was enough to continue. The response headers have not been checked for `Retry-After` or `X-RateLimit-*` values.
* The `429` happened with requests spaced 1.0 to 1.5 seconds apart. Whether wider spacing avoids it has not been tested.

## 7. Verified and unverified

Observed directly:

* The base URL is `https://api-school.procareconnect.com/api/web`.
* Authentication uses a Bearer token, with `X-APP-ID: PCO` and `X-CLIENT-NAME: Web`.
* `/parent/kids` provides the child ID.
* `/parent/photos/` accepts `kid_id` and date filters in both date-only and date-and-time form.
* Photo responses contain `page`, `per_page` (30), `total` and `photos`, with no `next_page`.
* A page past the end returns an empty array.
* `/parent/videos/` returns video URLs, and `/parent/daily_activities/` can contain additional photos or videos.
* Media URLs are pre-signed and expire.
* The API returns HTTP `429` after a long run of requests.

Not verified:

* Whether `/parent/videos/` and `/parent/daily_activities/` report `total` or `next_page`.
* Whether the videos and daily activities endpoints accept date filters, and in what syntax.
* Whether a date-only `datetime_to` includes photos from the whole final day.
* The actual rate limit behind the `429` responses.
* Whether `X-SITE-ID` is needed for all accounts or endpoints.
* How long full-size media URLs stay valid.
* Whether all historical media is available through these endpoints.
