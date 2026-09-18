/**
 * Explicit browser client and 1:1 models for the DiningCity Restaurant Week API.
 * Every API property is copied by name. Missing values use safe defaults:
 * strings -> '', numbers -> null, booleans -> false, arrays -> [].
 */

const DEFAULT_API_KEY = 'cgecegcegcc';
const DEFAULT_BASE_URL = 'https://api.diningcity.asia/public/extras_events/rwsg_autumn_2026';

const text = (value) => value ?? '';
const nullableText = (value) => value ?? null;
const number = (value) => value ?? null;
const flag = (value) => value ?? false;
const list = (value) => Array.isArray(value) ? value : [];
const record = (value) => value && typeof value === 'object' ? value : {};

// Keep model defaults available to callers, while JSON.stringify preserves
// the exact property shape returned by the API (including omitted properties).
const preserveApiShape = (model, source) => {
  const sourceKeys = new Set(Object.keys(source ?? {}));
  Object.defineProperty(model, 'toJSON', {
    enumerable: false,
    value() {
      const result = {};
      for (const key of sourceKeys) result[key] = model[key];
      return result;
    },
  });
};

export class Tag {
  constructor(data = {}) { data = record(data);
    this.id = number(data.id); this.name = text(data.name); this.icon_url = text(data.icon_url);
    preserveApiShape(this, data);
  }
}

export class Cuisine {
  constructor(data = {}) { data = record(data);
    this.id = number(data.id); this.name = text(data.name); this.dir_name = text(data.dir_name);
    this.restaurants_count = number(data.restaurants_count);
    preserveApiShape(this, data);
  }
}

export class Location {
  constructor(data = {}) { data = record(data);
    this.id = number(data.id); this.name = text(data.name);
    this.restaurants_count = number(data.restaurants_count);
    preserveApiShape(this, data);
  }
}

export class MealPrice {
  constructor(data = {}) { data = record(data);
    this.meal_type = text(data.meal_type); this.price = text(data.price);
    this.menu_title = text(data.menu_title); this.icon_url = text(data.icon_url);
    preserveApiShape(this, data);
  }
}

export class Restaurant {
  constructor(data = {}) { data = record(data);
    this.id = number(data.id); this.name = text(data.name); this.address = text(data.address);
    this.ratings_avg = number(data.ratings_avg); this.region_name = text(data.region_name);
    this.meal_group_name = text(data.meal_group_name); this.capacity_desc = text(data.capacity_desc);
    this.capacity_desc_text = text(data.capacity_desc_text); this.lng = number(data.lng); this.lat = number(data.lat);
    this.dirname = text(data.dirname); this.avg_price = number(data.avg_price);
    this.format_avg_price = text(data.format_avg_price); this.michelin_stars = number(data.michelin_stars);
    this.reservation_type = text(data.reservation_type); this.distance_to_restaurant = number(data.distance_to_restaurant);
    this.courses = list(data.courses); this.price_level = text(data.price_level);
    this.michelin_stars_text = text(data.michelin_stars_text);
    this.tags = list(data.tags).map((item) => new Tag(item));
    this.locations = list(data.locations).map((item) => new Location(item));
    this.prices = list(data.prices); this.meals_with_price = list(data.meals_with_price).map((item) => new MealPrice(item));
    this.detail_in_events_url = text(data.detail_in_events_url); this.thumb = text(data.thumb); this.cover = text(data.cover);
    this.cuisines = list(data.cuisines).map((item) => new Cuisine(item));
    preserveApiShape(this, data);
  }
}

export class RestaurantList {
  constructor(items = [], page = 1, per_page = items.length) {
    this.items = list(items).map((item) => item instanceof Restaurant ? item : new Restaurant(item));
    this.page = number(page) ?? 1; this.per_page = number(per_page) ?? 0;
  }
  get length() { return this.items.length; }
  toJSON() { return this.items; }
}

export class MenuSummary {
  constructor(data = {}) { data = record(data);
    this.photos_count = number(data.photos_count); this.comments_count = number(data.comments_count);
    preserveApiShape(this, data);
  }
}

export class MenuPhoto {
  constructor(data = {}) { data = record(data);
    this.id = number(data.id); this.url = text(data.url); this.photo_url = text(data.photo_url);
    this.image_url = text(data.image_url); this.caption = text(data.caption);
    preserveApiShape(this, data);
  }
}

export class MenuItem {
  constructor(data = {}) { data = record(data);
    this.photos_count = number(data.photos_count); this.comments_count = number(data.comments_count);
    preserveApiShape(this, data);
  }
}

export class MenuSubItem {
  constructor(data = {}) { data = record(data);
    this.id = number(data.id); this.desc = nullableText(data.desc); this.name = text(data.name);
    this.separator = text(data.separator); this.is_signature = flag(data.is_signature);
    this.comments_count = number(data.comments_count); this.photos_count = number(data.photos_count);
    this.price = text(data.price); this.up_sell_price = nullableText(data.up_sell_price); this.source_id = number(data.source_id);
    this.currency = text(data.currency); this.price_desc = nullableText(data.price_desc);
    this.menu = data.menu == null ? data.menu : new MenuItem(data.menu);
    this.menu_photos_count = number(data.menu_photos_count); this.photo_cover = nullableText(data.photo_cover);
    this.menu_photos = list(data.menu_photos).map((item) => new MenuPhoto(item));
    this.tags = list(data.tags).map((item) => new Tag(item));
    preserveApiShape(this, data);
  }
}

export class CourseGroup {
  constructor(data = {}) { data = record(data);
    this.id = number(data.id); this.name = text(data.name); this.optional_desc = nullableText(data.optional_desc);
    this.subs = list(data.subs).map((item) => new MenuSubItem(item));
    preserveApiShape(this, data);
  }
}

export class ExtrasMenu {
  constructor(data = {}) { data = record(data);
    this.id = number(data.id); this.desc = nullableText(data.desc); this.description = nullableText(data.description);
    this.vat = text(data.vat); this.service_fee = text(data.service_fee);
    this.offer_wine_pairing = data.offer_wine_pairing ?? null; this.vat_text = text(data.vat_text);
    this.service_fee_text = text(data.service_fee_text);
    this.course_groups = list(data.course_groups).map((item) => new CourseGroup(item));
    preserveApiShape(this, data);
  }
}

export class Meal {
  constructor(data = {}) {
    this.id = number(data.id); this.meal_type = text(data.meal_type); this.key_word = text(data.key_word);
    this.price = text(data.price); this.menu_title = text(data.menu_title); this.desc = text(data.desc);
    this.show_signature = flag(data.show_signature); this.signature_text = nullableText(data.signature_text);
    this.terms_conditions = text(data.terms_conditions); this.meal_type_humanize = text(data.meal_type_humanize);
    this.seats_multiplier = number(data.seats_multiplier); this.minimum_seats = number(data.minimum_seats);
    this.deposit_amount = number(data.deposit_amount); this.seats_multiplier_humanize = text(data.seats_multiplier_humanize);
    this.minimum_seats_humanize = text(data.minimum_seats_humanize);
    this.extras_menu = data.extras_menu == null ? data.extras_menu : new ExtrasMenu(data.extras_menu);
    preserveApiShape(this, data);
  }
}

export class RestaurantMenu {
  constructor(restaurantId, meals = []) {
    this.restaurantId = restaurantId ?? null;
    this.meals = list(meals).map((item) => item instanceof Meal ? item : new Meal(item));
  }
  get length() { return this.meals.length; }
  toJSON() { return this.meals; }
}

export class DiningCityApiClient {
  constructor({ apiKey = DEFAULT_API_KEY, baseUrl = DEFAULT_BASE_URL, city = 'singapore' } = {}) {
    this.apiKey = apiKey; this.baseUrl = baseUrl.replace(/\/$/, ''); this.city = city;
  }

  async request(path, query = {}) {
    const url = new URL(`${this.baseUrl}/${path.replace(/^\//, '')}`);
    url.search = new URLSearchParams({ 'api-key': this.apiKey, ...query });
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`DiningCity API request failed (${response.status} ${response.statusText})`);
    return response.json();
  }

  async getRestaurants({ page = 1, per_page = 8, order_by = 'featured' } = {}) {
    const data = await this.request(`cities/${this.city}/restaurants`, {
      per_page: String(per_page), page: String(page), order_by,
    });
    if (!Array.isArray(data)) throw new TypeError('Restaurant response was not an array');
    return new RestaurantList(data, page, per_page);
  }

  async getAllRestaurants({ per_page = 8, order_by = 'featured' } = {}) {
    const restaurants = []; const seenIds = new Set();
    for (let page = 1; ; page += 1) {
      const result = await this.getRestaurants({ page, per_page, order_by });
      for (const restaurant of result.items) {
        if (restaurant.id == null || seenIds.has(restaurant.id)) continue;
        seenIds.add(restaurant.id); restaurants.push(restaurant);
      }
      if (result.length === 0 || result.length < per_page) break;
    }
    return new RestaurantList(restaurants, 1, restaurants.length);
  }

  async getMenu(restaurantId) {
    if (restaurantId == null || restaurantId === '') throw new TypeError('restaurantId is required');
    const data = await this.request(`restaurants/${encodeURIComponent(restaurantId)}/meals`, {
      platform: 'web', include_extras_menu: 'true', lang: 'en',
    });
    if (!Array.isArray(data)) throw new TypeError('Menu response was not an array');
    return new RestaurantMenu(restaurantId, data);
  }
}

export default DiningCityApiClient;
