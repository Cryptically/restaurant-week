const MEAL_TAB_LABELS = Object.freeze({
  brunch: 'Brunch',
  lunch: 'Lunch',
  dinner: 'Dinner',
});

const DISPLAY_SEPARATOR = ' 路 ';

function initialsFor(name) {
  return (name || 'RW')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

export class RestaurantPriceViewModel {
  constructor(price = {}) {
    this.model = price;
  }

  get key() {
    return `${this.model.meal_type || ''}-${this.model.price || ''}`;
  }

  get label() {
    const mealType = String(this.model.meal_type || '').toLowerCase();
    return MEAL_TAB_LABELS[mealType] || this.model.meal_type || this.model.menu_title || 'Menu';
  }

  get price() { return this.model.price || ''; }
}

export class RestaurantViewModel {
  constructor(restaurant = {}) {
    this.model = restaurant;
    this.priceItems = (restaurant.meals_with_price || []).map(
      (price) => new RestaurantPriceViewModel(price),
    );
  }

  get id() { return this.model.id; }
  get name() { return this.model.name; }
  get address() { return this.model.address; }
  get addressLabel() { return this.model.address || 'Singapore'; }
  get rating() { return this.model.ratings_avg; }
  get hasRating() { return Boolean(this.rating); }
  get regionName() { return this.model.region_name; }
  get region_name() { return this.regionName; }
  get hasRegion() { return Boolean(this.regionName && this.regionName !== 'Singapore'); }
  get imageUrl() { return this.model.cover || this.model.thumb; }
  get cover() { return this.model.cover; }
  get thumb() { return this.model.thumb; }
  get bookingUrl() { return this.model.detail_in_events_url; }
  get capacityNote() { return this.model.capacity_desc_text; }
  get tags() { return this.model.tags || []; }
  get hasTags() { return this.tags.length > 0; }
  get cuisineNames() {
    return (this.model.cuisines || []).map((cuisine) => cuisine.name).filter(Boolean);
  }
  get cuisineLabel() {
    return this.cuisineNames.length ? this.cuisineNames.join(DISPLAY_SEPARATOR) : 'Dining';
  }
  get locationNames() {
    return (this.model.locations || []).map((location) => location.name).filter(Boolean);
  }
  get locationLabel() {
    return this.locationNames.length
      ? this.locationNames.join(DISPLAY_SEPARATOR)
      : this.regionName || 'Singapore';
  }
  get initials() { return initialsFor(this.name); }
  get averagePriceLabel() { return this.model.format_avg_price; }
  get hasAveragePrice() { return Boolean(this.averagePriceLabel); }
  get lowestMealPrice() {
    const prices = this.priceItems
      .map((meal) => Number.parseFloat(String(meal.price).replace(/[^0-9.]/g, '')))
      .filter(Number.isFinite);

    return prices.length ? `SG$${Math.min(...prices)}` : '—';
  }
  get searchableText() {
    return [this.name, this.address, this.regionName, ...this.cuisineNames]
      .join(' ')
      .toLowerCase();
  }
}

export class MenuItemViewModel {
  constructor(item = {}, index = 0) {
    this.model = item;
    this.index = index;
  }

  get id() { return this.model.id; }
  get name() { return this.model.name; }
  get description() { return this.model.desc; }
  get hasDescription() { return Boolean(this.description); }
  get showSeparator() { return this.index > 0 && Boolean(this.model.separator); }
  get separator() { return this.model.separator; }
  get hasPrice() { return Boolean(this.model.price && this.model.price !== '0.0'); }
  get priceLabel() { return this.hasPrice ? `${this.model.currency || ''}${this.model.price}` : ''; }
  get tags() { return this.model.tags || []; }
  get hasTags() { return this.tags.length > 0; }
}

export class CourseGroupViewModel {
  constructor(course = {}) {
    this.model = course;
    this.items = (course.subs || []).map((item, index) => new MenuItemViewModel(item, index));
  }

  get id() { return this.model.id; }
  get name() { return this.model.name; }
  get hasItems() { return this.items.length > 0; }
}

export class MealViewModel {
  constructor(meal = {}) {
    this.model = meal;
    this.courseGroups = (meal.extras_menu?.course_groups || [])
      .map((course) => new CourseGroupViewModel(course));
  }

  get id() { return this.model.id; }
  get tabLabel() {
    const mealType = String(this.model.meal_type || '').toLowerCase();
    return this.model.meal_type_humanize
      || MEAL_TAB_LABELS[mealType]
      || this.model.meal_type
      || this.model.menu_title
      || 'Menu';
  }
  get title() { return this.model.menu_title || this.model.meal_type_humanize || this.model.meal_type; }
  get priceLabel() {
    if (this.model.desc?.startsWith('SG$')) {
      return this.model.desc.split(' p.p.')[0];
    }

    return this.model.price ? `SG$${this.model.price}` : '';
  }
  get description() {
    const description = this.model.desc || this.model.terms_conditions || '';

    if (this.priceLabel && description.startsWith(this.priceLabel)) {
      return '';
    }

    return description || 'Set menu';
  }
  get bookingDetails() {
    const details = [this.model.minimum_seats_humanize, this.model.seats_multiplier_humanize]
      .filter(Boolean);

    if (this.model.deposit_amount != null) {
      details.push(`Deposit S$${this.model.deposit_amount}`);
    }

    return details;
  }
  get hasBookingDetails() { return this.bookingDetails.length > 0; }
  get extrasDescription() { return this.model.extras_menu?.desc || ''; }
  get hasExtrasDescription() { return Boolean(this.extrasDescription); }
  get hasCourseGroups() { return this.courseGroups.some((course) => course.hasItems); }
  get notice() {
    const extras = this.model.extras_menu;
    if (!extras) return '';

    return [extras.vat_text, extras.service_fee_text].filter(Boolean).join(DISPLAY_SEPARATOR);
  }
  get hasNotice() { return Boolean(this.notice); }
}

export class RestaurantMenuViewModel {
  constructor(menu = {}) {
    this.restaurantId = menu.restaurantId ?? null;
    this.meals = (menu.meals || []).map((meal) => new MealViewModel(meal));
  }

  get length() { return this.meals.length; }
}
