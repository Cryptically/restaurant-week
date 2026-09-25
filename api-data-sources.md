# DiningCity API Data Sources

This project currently loads generated JSON from `public/data`. The refresh script can enrich that data by calling the additional restaurant-detail endpoints below.

Base event API:

```text
https://api.diningcity.asia/public/extras_events/rwsg_autumn_2026
```

API key is passed as the `api-key` query parameter. Keep the key in the refresh pipeline only; do not add a new browser-side dependency on these endpoints just to display detail data.

## 1. Restaurant directory

Used by the current data refresh script:

```http
GET /cities/singapore/restaurants
```

Query parameters:

```text
api-key=<API_KEY>
page=1
per_page=8
order_by=featured
```

Current local output:

```text
public/data/restaurants/restaurants.json
```

This endpoint provides directory-level fields such as name, address, rating, cover/thumb, cuisines, locations, tags, meal prices, price level, and restaurant URL. It does not provide the full restaurant detail profile.

## 2. Restaurant detail profile

This is the missing call needed for opening hours, phone, description, extras, landmarks, and richer detail metadata.

```http
GET https://api.diningcity.asia/public/restaurants/{dirname}
```

Example for NOA Lounge By Olivia:

```text
https://api.diningcity.asia/public/restaurants/noa_by_Olivia?platform=web&project=rwsg_autumn_2026&api-key=<API_KEY>
```

Query parameters:

```text
platform=web
project=rwsg_autumn_2026
api-key=<API_KEY>
```

Important response fields:

| Response field | UI meaning | Example for NOA |
| --- | --- | --- |
| `opening_hour` | Opening-hours text | Monday–Saturday service hours and Sunday closed |
| `localized_opening_hour` | Localized opening-hours text | Same value for English |
| `phone` | Phone action | `80685535` |
| `basic_info.address` | Detailed address | `83 Neil Rd, 01, #01-02-03, 089813` |
| `basic_info.description` | Restaurant overview copy | NOA description text |
| `extras[]` | Editorial/category labels | `High end dining` |
| `tags[]` | Operational tags | `Instant booking` |
| `landmarks[]` | Nearby landmark labels | `Keong Saik` |
| `pictures_photos_count` | Gallery/photo count | Number of restaurant photos |
| `reviews_count` | Review count | Number of reviews |
| `ratings_avg` | Overall rating | `9.3` |
| `cover` / `wide_picture` | Detail hero imagery | Restaurant cover images |
| `lat` / `lng` | Map coordinates | Restaurant map position |
| `website_detail_url` | Restaurant website/detail URL | External restaurant URL |
| `reservation_type_human` | Reservation label | Human-readable reservation type |

For NOA specifically, the live response contains:

```js
{
  opening_hour: 'Monday: ...',
  basic_info: {
    address: '83 Neil Rd, 01, #01-02-03, 089813',
    description: '...'
  },
  extras: [{ name: 'High end dining' }],
  tags: [{ name: 'Instant booking' }],
  landmarks: [{ name: 'Keong Saik' }]
}
```

Important: `High end dining` comes from `extras`, not `tags`.

## 3. Restaurant menu

Used by the current client and refresh script:

```http
GET /restaurants/{restaurantId}/meals
```

Example:

```text
https://api.diningcity.asia/public/extras_events/rwsg_autumn_2026/restaurants/205191138/meals?api-key=<API_KEY>&platform=web&include_extras_menu=true&lang=en
```

Query parameters:

```text
api-key=<API_KEY>
platform=web
include_extras_menu=true
lang=en
```

Current local output:

```text
public/data/menus/{restaurant-file}.json
```

This endpoint provides meals, prices, minimum seats, deposits, course groups, menu items, supplements, VAT, and service-charge notices.

## 4. Optional detail endpoints

The live NOA page also calls these endpoints:

### Capacity / availability

```http
GET /extras_events/rwsg_autumn_2026/restaurants/{restaurantId}/capacity
```

Parameters:

```text
platform=web
api-key=<API_KEY>
lang=en
```

Use this only if the product later needs real date, party-size, or seat availability. The current local JSON does not contain enough data for those filters.

### Restaurant pictures

```http
GET /restaurants/{restaurantId}/pictures
```

Parameters:

```text
api-key=<API_KEY>
lang=en
per_page=5
```

Use this for a detail gallery and photo count.

### Review score distribution

```http
GET /restaurants/{restaurantId}/review_stars_ratio
```

Parameter:

```text
platform=web
```

### Hand-picked reviews

```http
GET /reviews/handpick
```

Parameters:

```text
platform=web
source_type=restaurant
source_id={restaurantId}
```

Use this for review cards, excerpts, scores, verification, and review photos.

## Recommended refresh-script change

For each restaurant returned by the directory endpoint:

1. Save the existing directory record.
2. Call `/public/restaurants/{dirname}`.
3. Save a normalized detail record under `public/data/restaurants/details/`.
4. Optionally call pictures, review, and capacity endpoints only when those features are needed.
5. Keep the menu call separate because it already has its own generated files.

Suggested output shape:

```json
{
  "restaurant_id": 205191138,
  "dirname": "noa_by_Olivia",
  "opening_hour": "...",
  "phone": "80685535",
  "address": "83 Neil Rd, 01, #01-02-03, 089813",
  "description": "...",
  "extras": [{ "id": 3930, "name": "High end dining" }],
  "tags": [{ "id": 10429, "name": "Instant booking" }],
  "landmarks": [{ "id": 2000352, "name": "Keong Saik" }],
  "pictures": [],
  "reviews": null,
  "capacity": null
}
```

This keeps the frontend on stable local JSON while allowing the refresh process to progressively add richer restaurant detail features.
