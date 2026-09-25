import './styles.css';
import { computed, createApp, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Restaurant, RestaurantMenu } from './client.js';
import { RestaurantMenuViewModel, RestaurantViewModel } from './view-models.js';

createApp({
  setup() {
    const restaurants = ref([]);
    const menuFiles = ref({});
    const menuDataBase = ref('./data/');
    const menuHashes = ref({});
    const scoreEntries = ref({});
    const selectedRestaurant = ref(null);
    const menu = ref(null);
    const menuScore = ref(null);
    const activeMealIndex = ref(0);
    const query = ref('');
    const cuisine = ref('');
    const mealType = ref('');
    const location = ref('');
    const tag = ref('');
    const priceLevel = ref('');
    const sortBy = ref('featured');
    const loading = ref(true);
    const menuLoading = ref(false);
    const loadError = ref('');
    const menuError = ref('');
    const detailBackButton = ref(null);
    const isMobileLayout = ref(false);
    let pageOverflow = '';
    let rootOverflow = '';

    function isMobileDetailView() {
      return isMobileLayout.value;
    }

    function updateMobileLayout() {
      const nextIsMobileLayout = window.matchMedia('(max-width: 1079px)').matches;

      if (selectedRestaurant.value && isMobileLayout.value !== nextIsMobileLayout) {
        if (nextIsMobileLayout) {
          lockBackgroundScroll();
        } else {
          unlockBackgroundScroll();
        }
      }

      isMobileLayout.value = nextIsMobileLayout;
    }

    function lockBackgroundScroll() {
      pageOverflow = document.body.style.overflow;
      rootOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }

    function unlockBackgroundScroll() {
      document.body.style.overflow = pageOverflow;
      document.documentElement.style.overflow = rootOverflow;
    }

    const cuisineOptions = computed(() => [
      ...new Set(
        restaurants.value
          .flatMap((restaurant) => restaurant.cuisineNames)
          .filter(Boolean),
      ),
    ].sort());

    const mealTypeOptions = computed(() => [
      ...new Set(restaurants.value.flatMap((restaurant) => restaurant.mealTypeLabels)),
    ].sort());

    const locationOptions = computed(() => [
      ...new Set(restaurants.value.flatMap((restaurant) => restaurant.locationNames)),
    ].sort());

    const tagOptions = computed(() => [
      ...new Set(restaurants.value.flatMap((restaurant) => restaurant.tagNames)),
    ].sort());

    const priceLevelOptions = computed(() => [
      ...new Set(
        restaurants.value
          .map((restaurant) => restaurant.priceLevelLabel)
          .filter(Boolean),
      ),
    ]);

    const sortOptions = [
      { value: 'featured', label: 'Featured' },
      { value: 'rating', label: 'Rating' },
      { value: 'price-low', label: 'Price: low to high' },
      { value: 'price-high', label: 'Price: high to low' },
      { value: 'name-asc', label: 'Name: A–Z' },
      { value: 'name-desc', label: 'Name: Z–A' },
    ];

    const hasActiveFilters = computed(() => Boolean(
      query.value
      || cuisine.value
      || mealType.value
      || location.value
      || tag.value
      || priceLevel.value
      || sortBy.value !== 'featured'
    ));

    const filteredRestaurants = computed(() => {
      const term = query.value.toLowerCase();

      return restaurants.value.filter((restaurant) => {
        const matchesSearch = !term || restaurant.searchableText.includes(term);
        const matchesCuisine = !cuisine.value || restaurant.cuisineNames.includes(cuisine.value);
        const matchesMealType = !mealType.value || restaurant.mealTypeLabels.includes(mealType.value);
        const matchesLocation = !location.value || restaurant.locationNames.includes(location.value);
        const matchesTag = !tag.value || restaurant.tagNames.includes(tag.value);
        const matchesPriceLevel = !priceLevel.value || restaurant.priceLevelLabel === priceLevel.value;

        return matchesSearch
          && matchesCuisine
          && matchesMealType
          && matchesLocation
          && matchesTag
          && matchesPriceLevel;
      }).sort((left, right) => {
        if (sortBy.value === 'rating') {
          return (right.rating || -Infinity) - (left.rating || -Infinity);
        }
        if (sortBy.value === 'price-low') {
          return left.lowestMealPriceValue - right.lowestMealPriceValue;
        }
        if (sortBy.value === 'price-high') {
          return right.lowestMealPriceValue - left.lowestMealPriceValue;
        }
        if (sortBy.value === 'name-asc') {
          return left.name.localeCompare(right.name);
        }
        if (sortBy.value === 'name-desc') {
          return right.name.localeCompare(left.name);
        }
        return 0;
      });
    });

    function clearFilters() {
      query.value = '';
      cuisine.value = '';
      mealType.value = '';
      location.value = '';
      tag.value = '';
      priceLevel.value = '';
      sortBy.value = 'featured';
    }

    function cuisineLabel(restaurant) {
      const names = restaurant.cuisines
        .map((cuisine) => cuisine.name)
        .filter(Boolean);

      return names.length ? names.join(' · ') : 'Dining';
    }

    function locationLabel(restaurant) {
      const names = restaurant.locations
        .map((location) => location.name)
        .filter(Boolean);

      return names.length ? names.join(' · ') : restaurant.region_name || 'Singapore';
    }

    function initials(name) {
      return (name || 'RW')
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
        .toUpperCase();
    }

    function lowestMealPrice(restaurant) {
      const prices = restaurant.meals_with_price
        .map((meal) => Number.parseFloat(String(meal.price).replace(/[^0-9.]/g, '')))
        .filter(Number.isFinite);

      return prices.length ? `SG$${Math.min(...prices)}` : '—';
    }

    function mealTabLabel(meal) {
      return meal.label || meal.tabLabel || 'Menu';
    }

    function mealTabId(index) {
      return `meal-tab-${index}`;
    }

    function mealPanelId() {
      return 'meal-panel';
    }

    const activeMeal = computed(() => menu.value?.meals?.[activeMealIndex.value] || menu.value?.meals?.[0] || null);

    function scoreForCourse(mealIndex, courseIndex) {
      return menuScore.value?.meals?.[mealIndex]?.courses?.[courseIndex] ?? null;
    }

    function criterionLabel(id) {
      return ({ fish: 'Fish', shellfish: 'Shellfish', beef: 'Beef', pork: 'Pork', poultry: 'Poultry', lamb_goat: 'Lamb or goat', vegetarian: 'Vegetarian' })[id] || id;
    }

    function selectMeal(index, { updateUrl = true } = {}) {
      if (!menu.value?.meals?.[index]) return;

      if (updateUrl) {
        updateMealUrl(index);
      }

      activeMealIndex.value = index;
    }

    function moveMealTab(index, direction) {
      const mealCount = menu.value?.meals?.length || 0;
      if (mealCount < 2) return;

      const nextIndex = (index + direction + mealCount) % mealCount;
      selectMeal(nextIndex);
      nextTick(() => document.getElementById(mealTabId(nextIndex))?.focus());
    }

    function focusMealTabEdge(edge) {
      const mealCount = menu.value?.meals?.length || 0;
      if (mealCount < 2) return;

      const nextIndex = edge === 'last' ? mealCount - 1 : 0;
      selectMeal(nextIndex);
      nextTick(() => document.getElementById(mealTabId(nextIndex))?.focus());
    }

    function mealPriceLabel(meal) {
      return meal.priceLabel;
    }

    function mealDescription(meal) {
      return meal.description;
    }

    function mealBookingDetails(meal) {
      return meal.bookingDetails;
    }

    function mealNotice(meal) {
      return meal.notice;
    }

    function updateRestaurantUrl(restaurantId, replace = false) {
      const url = new URL(window.location.href);

      if (restaurantId == null) {
        url.searchParams.delete('restaurant');
        url.searchParams.delete('menu');
      } else {
        url.searchParams.set('restaurant', String(restaurantId));
        url.searchParams.delete('menu');
      }

      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

      if (nextUrl === currentUrl) return;

      const method = replace ? 'replaceState' : 'pushState';
      window.history[method]({ restaurantId }, '', nextUrl);
    }

    function mealUrlKey(meal, index) {
      return meal.id != null ? String(meal.id) : String(index);
    }

    function updateMealUrl(index, replace = false) {
      const url = new URL(window.location.href);
      const meal = menu.value?.meals?.[index];

      if (meal) {
        url.searchParams.set('menu', mealUrlKey(meal, index));
      } else {
        url.searchParams.delete('menu');
      }

      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

      if (nextUrl === currentUrl) return;

      const method = replace ? 'replaceState' : 'pushState';
      window.history[method]({
        restaurantId: selectedRestaurant.value?.id ?? null,
        mealId: meal?.id ?? null,
      }, '', nextUrl);
    }

    function syncMealFromUrl({ replaceInvalid = false } = {}) {
      const mealKey = new URL(window.location.href).searchParams.get('menu');
      if (mealKey == null) {
        activeMealIndex.value = 0;
        return;
      }

      const mealIndex = menu.value?.meals?.findIndex(
        (meal, index) => mealUrlKey(meal, index) === mealKey,
      ) ?? -1;

      if (mealIndex < 0) {
        activeMealIndex.value = 0;
        updateMealUrl(null, replaceInvalid);
        return;
      }

      selectMeal(mealIndex, { updateUrl: false });
    }

    function restaurantFromUrl() {
      const restaurantId = new URL(window.location.href).searchParams.get('restaurant');
      if (!restaurantId) return null;

      return restaurants.value.find((restaurant) => String(restaurant.id) === restaurantId) || null;
    }

    function handleHistoryChange() {
      const restaurant = restaurantFromUrl();

      if (restaurant && selectedRestaurant.value?.id === restaurant.id && menu.value) {
        syncMealFromUrl();
      } else if (restaurant) {
        selectRestaurant(restaurant, { updateUrl: false });
      } else {
        clearSelection({ updateUrl: false });
      }
    }

    async function loadDirectory() {
      try {
        const [restaurantResponse, indexResponse, metadataResponse, scoreIndexResponse] = await Promise.all([
          fetch(`${menuDataBase.value}restaurants/restaurants.json`),
          fetch(`${menuDataBase.value}menus/index.json`),
          fetch(`${menuDataBase.value}menus/metadata.json`),
          fetch(`${menuDataBase.value}scores/index.json`),
        ]);

        if (!restaurantResponse.ok || !indexResponse.ok) {
          throw new Error('The published data files could not be found.');
        }

        const [restaurantData, indexData, metadataData, scoreIndexData] = await Promise.all([
          restaurantResponse.json(),
          indexResponse.json(),
          metadataResponse.ok ? metadataResponse.json() : Promise.resolve({ menus: {} }),
          scoreIndexResponse.ok ? scoreIndexResponse.json() : Promise.resolve({ byRestaurantId: {} }),
        ]);

        restaurants.value = restaurantData.map(
          (item) => new RestaurantViewModel(new Restaurant(item)),
        );
        menuFiles.value = indexData;
        const menuMetadata = metadataData.menus || {};
        menuHashes.value = Object.fromEntries(
          Object.entries(menuMetadata as Record<string, { menuHash: string }>).map(([id, item]) => [id, item.menuHash]),
        );
        scoreEntries.value = scoreIndexData.byRestaurantId || {};

        const deepLinkedRestaurant = restaurantFromUrl();
        if (deepLinkedRestaurant) {
          selectRestaurant(deepLinkedRestaurant, { updateUrl: false });
        } else if (new URL(window.location.href).searchParams.has('restaurant') || new URL(window.location.href).searchParams.has('menu')) {
          updateRestaurantUrl(null, true);
        }
      } catch (error) {
        loadError.value = error.message || 'Please try again.';
      } finally {
        loading.value = false;
      }
    }

    async function loadRestaurantScore(restaurant) {
      const id = String(restaurant.id);
      const scoreEntry = scoreEntries.value[id];
      if (!scoreEntry || typeof scoreEntry.scoreFile !== 'string' || scoreEntry.menuHash !== menuHashes.value[id]) return;

      try {
        const response = await fetch(`${menuDataBase.value}scores/${encodeURIComponent(scoreEntry.scoreFile)}`);
        if (!response.ok) return;
        const candidate = await response.json();
        if (String(selectedRestaurant.value?.id) !== id) return;
        if (String(candidate.restaurantId) === id
          && candidate.menuHash === scoreEntry.menuHash
          && candidate.rubricVersion === scoreEntry.rubricVersion
          && candidate.promptVersion === scoreEntry.promptVersion) {
          menuScore.value = candidate;
        }
      } catch {
        // Scores are optional; a missing or unreadable score must not block menus.
      }
    }

    async function selectRestaurant(restaurant, { updateUrl = true } = {}) {
      if (updateUrl) {
        updateRestaurantUrl(restaurant.id);
      }

      selectedRestaurant.value = restaurant;
      menu.value = null;
      menuScore.value = null;
      activeMealIndex.value = 0;
      menuError.value = '';
      menuLoading.value = true;
      await nextTick();

      if (isMobileDetailView()) {
        lockBackgroundScroll();
        detailBackButton.value?.focus();
      }

      try {
        const filename = menuFiles.value[restaurant.id];

        if (!filename) {
          throw new Error('No menu file is available for this restaurant.');
        }

        const response = await fetch(`${menuDataBase.value}menus/${encodeURIComponent(filename)}`);

        if (!response.ok) {
          throw new Error('The menu file could not be opened.');
        }

        const data = await response.json();
        menu.value = new RestaurantMenuViewModel(
          new RestaurantMenu(restaurant.id, data.meals || []),
        );
        void loadRestaurantScore(restaurant);
        activeMealIndex.value = 0;
        syncMealFromUrl({ replaceInvalid: true });
      } catch (error) {
        menuError.value = error.message || 'Please try again.';
      } finally {
        menuLoading.value = false;
      }
    }

    function clearSelection({ updateUrl = true } = {}) {
      if (updateUrl) {
        updateRestaurantUrl(null);
      }

      selectedRestaurant.value = null;
      menu.value = null;
      activeMealIndex.value = 0;
      unlockBackgroundScroll();
    }

    onMounted(() => {
      updateMobileLayout();
      window.addEventListener('resize', updateMobileLayout);
      window.addEventListener('popstate', handleHistoryChange);
      loadDirectory();
    });
    onUnmounted(() => {
      window.removeEventListener('resize', updateMobileLayout);
      window.removeEventListener('popstate', handleHistoryChange);
      unlockBackgroundScroll();
    });

    return {
      restaurants,
      selectedRestaurant,
      menu,
      activeMeal,
      menuScore,
      activeMealIndex,
      query,
      cuisine,
      mealType,
      location,
      tag,
      priceLevel,
      sortBy,
      cuisineOptions,
      mealTypeOptions,
      criterionLabel,
      locationOptions,
      tagOptions,
      priceLevelOptions,
      scoreForCourse,
      sortOptions,
      hasActiveFilters,
      filteredRestaurants,
      loading,
      menuLoading,
      loadError,
      menuError,
      detailBackButton,
      isMobileLayout,
      cuisineLabel,
      locationLabel,
      initials,
      lowestMealPrice,
      mealTabLabel,
      mealTabId,
      mealPanelId,
      mealDescription,
      selectMeal,
      moveMealTab,
      focusMealTabEdge,
      mealPriceLabel,
      mealBookingDetails,
      mealNotice,
      clearFilters,
      selectRestaurant,
      clearSelection,
    };
  },
}).mount('#app');
