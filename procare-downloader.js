/**
 * Procare Photo & Video Downloader
 *
 * Instructions:
 * 1. Open the Procare web application and log in.
 * 2. Press F12 to open Developer Tools.
 * 3. Go to the "Console" tab.
 * 4. Paste this entire script into the console and press Enter.
 * 5. Leave the tab open while it downloads all media.
 *
 * This script:
 * - Finds your children from the Procare API.
 * - Downloads photos, videos, and media attached to daily activities.
 * - Deduplicates media by URL.
 * - Preserves the media creation date in the filename.
 * - Adds EXIF dates to JPEGs when possible.
 * - Retries temporary API/download failures.
 * - Continues when individual requests fail.
 */

(async function runProcareDownloader() {

    // ============================================================
    // CONFIGURATION
    // ============================================================

    // true  = only inspect the current month, then download media
    //         from the last 30 days.
    // false = search from START_YEAR through the current month.
    const DEBUG = false;

    // Used only when DEBUG is false.
    const START_YEAR = 2020;

    // Number of times to retry failed API/file requests.
    const MAX_RETRIES = 3;

    // Minimum gap between any two requests (ms). Applies to every attempt,
    // including retries.
    const API_DELAY_MS = 1000;

    // Minimum gap for photo requests (ms): the month-by-month photo scan
    // and the photo/video file downloads.
    const PHOTO_DELAY_MS = 1500;

    // How long to wait before retrying after an HTTP 429 (ms).
    const RATE_LIMIT_DELAY_MS = 60000;

    // Stop the photo scan after this many consecutive months with no
    // photos (scanning newest to oldest, once photos have been found).
    const EMPTY_MONTHS_TO_STOP = 6;

    // ============================================================
    // STARTUP
    // ============================================================

    console.log("🚀 Starting Procare Downloader...");
    console.log(`🛠️ DEBUG mode: ${DEBUG}`);
    console.log(`📅 Start year: ${START_YEAR}`);

    // ============================================================
    // GENERAL HELPERS
    // ============================================================

    const sleep = (ms) =>
        new Promise((resolve) => setTimeout(resolve, ms));

    function pad(number) {
        return String(number).padStart(2, "0");
    }

    function safeFilename(value) {
        return String(value || "Child").replace(/[^a-zA-Z0-9_-]/g, "");
    }

    function getExtensionFromUrl(url, fallback = "jpg") {
        if (!url || typeof url !== "string") {
            return fallback;
        }

        try {
            const pathname = new URL(url).pathname;
            const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
            if (match) {
                return match[1].toLowerCase();
            }
        } catch (e) {
            // Fall through to fallback.
        }

        return fallback;
    }

    function parseDate(dateString) {
        if (!dateString) {
            return null;
        }

        const date = new Date(dateString);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function getFileDateString(dateString) {
        const date = parseDate(dateString);
        if (!date) {
            return "unknown-date";
        }

        return (
            `${date.getFullYear()}-` +
            `${pad(date.getMonth() + 1)}-` +
            `${pad(date.getDate())}_` +
            `${pad(date.getHours())}-` +
            `${pad(date.getMinutes())}-` +
            `${pad(date.getSeconds())}`
        );
    }

    function getExifDateString(dateString) {
        const date = parseDate(dateString);
        if (!date) {
            return null;
        }

        return (
            `${date.getFullYear()}:` +
            `${pad(date.getMonth() + 1)}:` +
            `${pad(date.getDate())} ` +
            `${pad(date.getHours())}:` +
            `${pad(date.getMinutes())}:` +
            `${pad(date.getSeconds())}`
        );
    }

    function getMonthDateRange(year, month) {
        // month is 1–12.
        // new Date(year, month, 0) gives the final day of the requested month.
        const lastDay = new Date(year, month, 0).getDate();
        const monthString = pad(month);

        return {
            from: `${year}-${monthString}-01`,
            to: `${year}-${monthString}-${pad(lastDay)}`
        };
    }

    // ============================================================
    // LOAD PIEXIF ONLY WHEN NEEDED
    // ============================================================

    let piexifLoadPromise = null;

    async function loadPiexif() {
        if (window.piexif) {
            return window.piexif;
        }

        if (piexifLoadPromise) {
            return piexifLoadPromise;
        }

        piexifLoadPromise = new Promise((resolve, reject) => {
            console.log("📦 Loading piexifjs library...");

            const script = document.createElement("script");
            script.src =
                "https://cdnjs.cloudflare.com/ajax/libs/piexifjs/1.0.6/piexif.js";

            script.onload = () => {
                if (window.piexif) {
                    console.log("✅ piexifjs loaded.");
                    resolve(window.piexif);
                } else {
                    reject(
                        new Error(
                            "piexifjs loaded but window.piexif was not created."
                        )
                    );
                }
            };

            script.onerror = () => {
                reject(new Error("Could not load piexifjs from cdnjs."));
            };

            document.head.appendChild(script);
        });

        return piexifLoadPromise;
    }

    // ============================================================
    // AUTHENTICATION
    // ============================================================

    function getProcareToken() {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);

            try {
                const value = localStorage.getItem(key);
                if (!value) {
                    continue;
                }

                const parsed = JSON.parse(value);

                // Format:
                // {
                //   currentUser: {
                //     data: {
                //       auth_token: "..."
                //     }
                //   }
                // }
                if (parsed.currentUser) {
                    const currentUser =
                        typeof parsed.currentUser === "string"
                            ? JSON.parse(parsed.currentUser)
                            : parsed.currentUser;

                    if (
                        currentUser &&
                        currentUser.data &&
                        currentUser.data.auth_token
                    ) {
                        return currentUser.data.auth_token;
                    }
                }

                // Direct auth_token format.
                if (parsed.auth_token) {
                    const token =
                        typeof parsed.auth_token === "string"
                            ? parsed.auth_token
                            : parsed.auth_token;

                    if (token) {
                        return token;
                    }
                }
            } catch (e) {
                // Ignore localStorage entries that are not JSON.
            }
        }

        return prompt(
            "Could not automatically find your Procare token.\n\n" +
                "Open Application → Local Storage → " +
                "persist:kinderlime and paste your Bearer token here:"
        );
    }

    const TOKEN = getProcareToken();

    if (!TOKEN) {
        console.error("❌ No authorization token found. Cannot proceed.");
        return;
    }

    const headers = {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/json",
        "X-APP-ID": "PCO",
        "X-CLIENT-NAME": "Web"
    };

    // ============================================================
    // FETCH WITH RETRIES
    // ============================================================

    // Time the last request started.
    let lastRequestAt = 0;

    // Wait until at least minGapMs has passed since the previous
    // request, then mark this one as started.
    async function throttle(minGapMs) {
        const wait = lastRequestAt + minGapMs - Date.now();
        if (wait > 0) {
            await sleep(wait);
        }
        lastRequestAt = Date.now();
    }

    // delayMs: minimum gap since the previous request, enforced before
    // every attempt (including retries).
    async function fetchWithRetry(
        url,
        options = {},
        label = "request",
        delayMs = API_DELAY_MS
    ) {
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            let retryable = true;
            let rateLimited = false;

            try {
                await throttle(delayMs);

                const response = await fetch(url, options);

                if (response.ok) {
                    return response;
                }

                // These statuses are not worth retrying.
                if (
                    response.status === 400 ||
                    response.status === 401 ||
                    response.status === 403 ||
                    response.status === 404 ||
                    response.status === 422
                ) {
                    const errorText = await response.text().catch(() => "");
                    lastError = new Error(
                        `${label} failed with HTTP ${response.status}: ${errorText}`
                    );
                    retryable = false;
                } else {
                    lastError = new Error(
                        `${label} failed with HTTP ${response.status}`
                    );

                    if (response.status === 429) {
                        rateLimited = true;
                    }
                }
            } catch (error) {
                lastError = error;
            }

            if (!retryable) {
                break;
            }

            if (attempt < MAX_RETRIES) {
                // Other failures just retry; throttle() enforces the gap.
                console.warn(
                    `⚠️ ${label} failed (attempt ${attempt}/${MAX_RETRIES}). ` +
                        (rateLimited
                            ? `Rate limited, waiting ${RATE_LIMIT_DELAY_MS}ms...`
                            : "Retrying..."),
                    lastError
                );

                if (rateLimited) {
                    await sleep(RATE_LIMIT_DELAY_MS);
                }
            }
        }

        throw lastError || new Error(`${label} failed.`);
    }

    // ============================================================
    // PAGINATED API FETCH
    // ============================================================

    async function fetchAllPages(
        endpoint,
        kidId,
        label,
        queryExtras = "",
        delayMs = API_DELAY_MS
    ) {
        let page = 1;
        const allItems = [];

        while (true) {
            let url =
                `https://api-school.procareconnect.com/api/web` +
                `${endpoint}?page=${page}` +
                `&kid_id=${encodeURIComponent(kidId)}`;

            if (queryExtras) {
                url += queryExtras;
            }

            console.log(
                `📡 Fetching ${label} page ${page} for kid ID ${kidId}...`
            );

            let response;
            try {
                response = await fetchWithRetry(
                    url,
                    { headers },
                    `${label} page ${page}`,
                    delayMs
                );
            } catch (error) {
                console.error(`❌ Giving up on ${label} page ${page}.`, error);
                // Continue with whatever pages we already got.
                break;
            }

            let data;
            try {
                data = await response.json();
            } catch (error) {
                console.error(
                    `❌ Could not parse JSON from ${label} page ${page}.`,
                    error
                );
                break;
            }

            // Extract items based on expected root keys.
            let items =
                data.photos ||
                data.videos ||
                data.daily_activities ||
                data.data ||
                [];

            // Some APIs return the array directly.
            if (!Array.isArray(items) && Array.isArray(data)) {
                items = data;
            }

            if (!Array.isArray(items)) {
                console.warn(
                    `⚠️ Unexpected response format for ${label} page ${page}.`,
                    data
                );
                break;
            }

            if (items.length === 0) {
                console.log(`ℹ️ No items found on ${label} page ${page}.`);
            } else {
                console.log(
                    `✅ Found ${items.length} items on ${label} page ${page}.`
                );
                allItems.push(...items);
            }

            // Pagination
            let nextPage = null;

            if (data && data.next_page) {
                nextPage = Number(data.next_page);
            } else if (data && data.meta && data.meta.next_page) {
                nextPage = Number(data.meta.next_page);
            }

            if (Number.isFinite(nextPage) && nextPage > page) {
                page = nextPage;
            } else {
                break;
            }
        }

        return allItems;
    }

    // ============================================================
    // GET CHILDREN
    // ============================================================

    console.log("📡 Fetching children profiles...");

    let kidsResponse;
    try {
        kidsResponse = await fetchWithRetry(
            "https://api-school.procareconnect.com/api/web/parent/kids",
            { headers },
            "children request"
        );
    } catch (error) {
        console.error("❌ Failed to fetch children.", error);
        return;
    }

    let kidsData;
    try {
        kidsData = await kidsResponse.json();
    } catch (error) {
        console.error("❌ Could not parse children response.", error);
        return;
    }

    let kids = kidsData.kids || kidsData.data || kidsData;

    if (!Array.isArray(kids)) {
        console.warn(
            "⚠️ Could not find an explicit list of children. " +
                "Using raw response as one child.",
            kidsData
        );
        kids = [kidsData];
    }

    console.log(`👶 Found ${kids.length} child(ren).`);

    if (kids.length === 0) {
        console.warn("⚠️ No children were returned by Procare.");
        return;
    }

    // ============================================================
    // BLOB / DATA URL HELPERS
    // ============================================================

    function blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    function dataURLtoBlob(dataurl) {
        const commaIndex = dataurl.indexOf(",");
        if (commaIndex === -1) {
            throw new Error("Invalid data URL.");
        }

        const header = dataurl.substring(0, commaIndex);
        const base64 = dataurl.substring(commaIndex + 1);

        const mimeMatch = header.match(/data:(.*?);base64/);
        if (!mimeMatch) {
            throw new Error("Could not determine data URL MIME type.");
        }

        const mime = mimeMatch[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        return new Blob([bytes], { type: mime });
    }

    // ============================================================
    // ADD EXIF TO JPEG
    // ============================================================

    async function addExifDate(blob, createdAt, filename) {
        const exifDate = getExifDateString(createdAt);
        if (!exifDate) {
            return blob;
        }

        try {
            const piexif = await loadPiexif();
            const dataUrl = await blobToDataURL(blob);
            const exifObj = piexif.load(dataUrl);

            // Ensure the expected EXIF sections exist.
            exifObj["Exif"] = exifObj["Exif"] || {};
            exifObj["0th"] = exifObj["0th"] || {};

            exifObj["Exif"][piexif.ExifIFD.DateTimeOriginal] = exifDate;
            exifObj["Exif"][piexif.ExifIFD.DateTimeDigitized] = exifDate;
            exifObj["0th"][piexif.ImageIFD.DateTime] = exifDate;

            const exifString = piexif.dump(exifObj);
            const newDataUrl = piexif.insert(exifString, dataUrl);

            return dataURLtoBlob(newDataUrl);
        } catch (error) {
            console.warn(
                `⚠️ Could not add EXIF to ${filename}. ` +
                    `Saving the original file instead.`,
                error
            );
            return blob;
        }
    }

    // ============================================================
    // DOWNLOAD ONE MEDIA FILE
    // ============================================================

    async function downloadMedia(media, filename) {
        const url = media.url;
        if (!url) {
            throw new Error("Media item has no URL.");
        }

        const response = await fetchWithRetry(
            url,
            {},
            `download ${filename}`,
            PHOTO_DELAY_MS
        );
        return await response.blob();
    }

    // ============================================================
    // DOWNLOAD MEDIA LIST
    // ============================================================

    async function downloadMediaItems(mediaList, kidName) {
        console.log(
            `🚀 Starting downloads for ${kidName}. ` +
                `Total items: ${mediaList.length}`
        );

        let successful = 0;
        let failed = 0;

        for (let i = 0; i < mediaList.length; i++) {
            const media = mediaList[i];

            const createdAt =
                media.created_at || media.captured_at || null;

            const extension = getExtensionFromUrl(
                media.url,
                media.mimeType === "video/mp4" ? "mp4" : "jpg"
            );

            const filename =
                `${kidName}_` +
                `${getFileDateString(createdAt)}_` +
                `${i + 1}.` +
                `${extension}`;

            console.log(
                `[${i + 1}/${mediaList.length}] Downloading: ${filename}...`
            );

            try {
                let blob = await downloadMedia(media, filename);

                // EXIF
                const isJpeg =
                    blob.type === "image/jpeg" ||
                    extension === "jpg" ||
                    extension === "jpeg";

                if (isJpeg) {
                    blob = await addExifDate(blob, createdAt, filename);
                }

                // Trigger browser download
                const downloadUrl = window.URL.createObjectURL(blob);
                const anchor = document.createElement("a");

                anchor.style.display = "none";
                anchor.href = downloadUrl;
                anchor.download = filename;

                document.body.appendChild(anchor);
                anchor.click();

                // Give the browser a moment to register the download.
                await sleep(100);

                window.URL.revokeObjectURL(downloadUrl);
                anchor.remove();

                successful++;
                console.log(`✅ Downloaded ${filename}`);
            } catch (error) {
                failed++;
                console.error(`❌ Failed to download ${filename}.`, error);
            }
        }

        console.log(
            `📊 ${kidName}: ${successful} downloaded, ${failed} failed.`
        );
    }

    // ============================================================
    // PROCESS EACH CHILD
    // ============================================================

    for (const kid of kids) {
        const kidId = kid.id;

        if (!kidId) {
            console.warn(
                "⚠️ Skipping child because no ID was found:",
                kid
            );
            continue;
        }

        const kidName = safeFilename(
            kid.first_name || kid.name || `Child_${kidId}`
        );

        console.log("\n=========================================");
        console.log(`🔍 Processing media for ${kidName}...`);
        console.log(`🆔 Kid ID: ${kidId}`);

        // URL → media object.
        // Using the URL as the key prevents the same media file
        // from being downloaded multiple times.
        const allMediaMap = new Map();

        // ========================================================
        // PHOTOS
        // ========================================================

        let photos = [];

        if (DEBUG) {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const range = getMonthDateRange(year, month);

            const query =
                `&filters[photo][datetime_from]=` +
                `${encodeURIComponent(range.from)}` +
                `&filters[photo][datetime_to]=` +
                `${encodeURIComponent(range.to)}`;

            console.log(
                `\n📅 Fetching photos for ${range.from} through ${range.to}...`
            );

            photos = await fetchAllPages(
                "/parent/photos/",
                kidId,
                "photos",
                query,
                PHOTO_DELAY_MS
            );
        } else {
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth() + 1;

            // Scan newest to oldest so we can stop once we run past
            // the earliest month that has photos.
            let foundPhotos = false;
            let emptyStreak = 0;

            scan: for (let year = currentYear; year >= START_YEAR; year--) {
                const lastMonth = year === currentYear ? currentMonth : 12;

                for (let month = lastMonth; month >= 1; month--) {
                    const range = getMonthDateRange(year, month);

                    const query =
                        `&filters[photo][datetime_from]=` +
                        `${encodeURIComponent(range.from)}` +
                        `&filters[photo][datetime_to]=` +
                        `${encodeURIComponent(range.to)}`;

                    console.log(
                        `\n📅 Fetching photos for ${range.from} through ${range.to}...`
                    );

                    const monthPhotos = await fetchAllPages(
                        "/parent/photos/",
                        kidId,
                        "photos",
                        query,
                        PHOTO_DELAY_MS
                    );

                    photos.push(...monthPhotos);

                    if (monthPhotos.length > 0) {
                        foundPhotos = true;
                        emptyStreak = 0;
                    } else if (foundPhotos) {
                        emptyStreak++;

                        if (emptyStreak >= EMPTY_MONTHS_TO_STOP) {
                            console.log(
                                `🛑 ${EMPTY_MONTHS_TO_STOP} months in a row ` +
                                    `with no photos. Stopping photo scan ` +
                                    `at ${range.from}.`
                            );
                            break scan;
                        }
                    }
                }
            }
        }

        // Add photos to deduplication map.
        for (const photo of photos) {
            const url = photo.main_url || photo.url;
            if (!url) {
                continue;
            }

            allMediaMap.set(url, {
                url,
                created_at: photo.created_at || photo.captured_at || null
            });
        }

        console.log(`📸 Added ${photos.length} photo records.`);

        // ========================================================
        // VIDEOS
        // ========================================================

        const videos = await fetchAllPages(
            "/parent/videos/",
            kidId,
            "videos"
        );

        for (const video of videos) {
            const url =
                video.video_file_url || video.main_url || video.url;

            if (!url) {
                continue;
            }

            allMediaMap.set(url, {
                url,
                created_at: video.created_at || video.captured_at || null
            });
        }

        console.log(`🎥 Added ${videos.length} video records.`);

        // ========================================================
        // DAILY ACTIVITIES
        // ========================================================

        const activities = await fetchAllPages(
            "/parent/daily_activities/",
            kidId,
            "daily_activities"
        );

        for (const activity of activities) {
            const activiable =
                activity.activiable || activity.activable;

            if (!activiable) {
                continue;
            }

            // Single media object
            const activityUrl =
                activiable.main_url ||
                activiable.video_file_url ||
                activiable.url;

            if (activityUrl) {
                allMediaMap.set(activityUrl, {
                    url: activityUrl,
                    created_at:
                        activity.created_at ||
                        activiable.created_at ||
                        null
                });
            }

            // Media arrays
            const mediaArray =
                activiable.photos || activiable.videos || [];

            if (!Array.isArray(mediaArray)) {
                continue;
            }

            for (const media of mediaArray) {
                const mediaUrl =
                    media.main_url ||
                    media.video_file_url ||
                    media.url;

                if (!mediaUrl) {
                    continue;
                }

                // IMPORTANT: Use mediaUrl as the key.
                // The old script accidentally used `url` here,
                // which could cause multiple media items to
                // overwrite one another.
                allMediaMap.set(mediaUrl, {
                    url: mediaUrl,
                    created_at:
                        activity.created_at ||
                        media.created_at ||
                        media.captured_at ||
                        null
                });
            }
        }

        console.log(
            `📋 Added ${activities.length} daily activity records.`
        );

        // ========================================================
        // DEDUPLICATE
        // ========================================================

        let deduplicatedMedia = Array.from(allMediaMap.values());

        console.log(
            `✅ Found ${deduplicatedMedia.length} unique media items for ${kidName}.`
        );

        // ========================================================
        // DEBUG FILTER
        // ========================================================

        if (DEBUG) {
            console.log(
                "🛠️ DEBUG MODE: Filtering to media from the last 30 days..."
            );

            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            deduplicatedMedia = deduplicatedMedia.filter((media) => {
                const itemDate = parseDate(media.created_at);

                if (!itemDate) {
                    console.warn(
                        "⚠️ Keeping media without a valid date out of debug filter:",
                        media.url
                    );
                    return true;
                }

                return itemDate >= thirtyDaysAgo;
            });

            console.log(
                `🛠️ DEBUG MODE: ${deduplicatedMedia.length} items remaining after filter.`
            );
        }

        // ========================================================
        // DOWNLOAD
        // ========================================================

        if (deduplicatedMedia.length === 0) {
            console.log(`ℹ️ No media to download for ${kidName}.`);
            continue;
        }

        await downloadMediaItems(deduplicatedMedia, kidName);
    }

    // ============================================================
    // DONE
    // ============================================================

    console.log("\n=========================================");
    console.log("🎉 All downloads complete!");
    console.log("=========================================");
})();