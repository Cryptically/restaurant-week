import './styles.css';
import { computed, createApp, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Restaurant, RestaurantMenu } from './client.js';
import { RestaurantMenuViewModel, RestaurantViewModel } from './view-models.js';

createApp({
  setup() {
    const restaurants = ref([]);
    const menuFiles = ref({});
    const selectedRestaurant = ref(null);
    const menu = ref(null);
    const activeMealIndex = ref(0);
    const query = ref('');
    const cuisine = ref('');
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

    const filteredRestaurants = computed(() => {
      const term = query.value.toLowerCase();

      return restaurants.value.filter((restaurant) => {
        const matchesSearch = !term || restaurant.searchableText.includes(term);
        const matchesCuisine = !cuisine.value || restaurant.cuisineNames.includes(cuisine.value);

        return matchesSearch && matchesCuisine;
      });
    });

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
        const [restaurantResponse, indexResponse] = await Promise.all([
          fetch('./data/restaurants/restaurants.json'),
          fetch('./data/menus/index.json'),
        ]);

        if (!restaurantResponse.ok || !indexResponse.ok) {
          throw new Error('The published data files could not be found.');
        }

        const [restaurantData, indexData] = await Promise.all([
          restaurantResponse.json(),
          indexResponse.json(),
        ]);

        restaurants.value = restaurantData.map(
          (item) => new RestaurantViewModel(new Restaurant(item)),
        );
        menuFiles.value = indexData;

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

    async function selectRestaurant(restaurant, { updateUrl = true } = {}) {
      if (updateUrl) {
        updateRestaurantUrl(restaurant.id);
      }

      selectedRestaurant.value = restaurant;
      menu.value = null;
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

        const response = await fetch(`./data/menus/${encodeURIComponent(filename)}`);

        if (!response.ok) {
          throw new Error('The menu file could not be opened.');
        }

        const data = await response.json();
        menu.value = new RestaurantMenuViewModel(
          new RestaurantMenu(restaurant.id, data.meals || []),
        );
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
      activeMealIndex,
      query,
      cuisine,
      cuisineOptions,
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
      selectRestaurant,
      clearSelection,
    };
  },
}).mount('#app');
