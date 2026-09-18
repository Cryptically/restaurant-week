import './styles.css';
import { computed, createApp, onMounted, ref } from 'vue';
import { Restaurant, RestaurantMenu } from './client.js';


createApp({
  setup() {
    const restaurants = ref([]);
    const menuFiles = ref({});
    const selectedRestaurant = ref(null);
    const menu = ref(null);
    const query = ref('');
    const cuisine = ref('');
    const loading = ref(true);
    const menuLoading = ref(false);
    const loadError = ref('');
    const menuError = ref('');

    const cuisineOptions = computed(() => [
      ...new Set(
        restaurants.value
          .flatMap((restaurant) => restaurant.cuisines.map((item) => item.name))
          .filter(Boolean),
      ),
    ].sort());

    const filteredRestaurants = computed(() => {
      const term = query.value.toLowerCase();

      return restaurants.value.filter((restaurant) => {
        const searchableText = [
          restaurant.name,
          restaurant.address,
          restaurant.region_name,
          ...restaurant.cuisines.map((item) => item.name),
        ].join(' ').toLowerCase();

        const matchesSearch = !term || searchableText.includes(term);
        const matchesCuisine = !cuisine.value || restaurant.cuisines.some(
          (item) => item.name === cuisine.value,
        );

        return matchesSearch && matchesCuisine;
      });
    });

    function primaryCuisine(restaurant) {
      return restaurant.cuisines[0]?.name || 'Singapore dining';
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

        restaurants.value = restaurantData.map((item) => new Restaurant(item));
        menuFiles.value = indexData;
      } catch (error) {
        loadError.value = error.message || 'Please try again.';
      } finally {
        loading.value = false;
      }
    }

    async function selectRestaurant(restaurant) {
      selectedRestaurant.value = restaurant;
      menu.value = null;
      menuError.value = '';
      menuLoading.value = true;
      window.scrollTo({ top: 0, behavior: 'smooth' });

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
        menu.value = new RestaurantMenu(restaurant.id, data.meals || []);
      } catch (error) {
        menuError.value = error.message || 'Please try again.';
      } finally {
        menuLoading.value = false;
      }
    }

    function clearSelection() {
      selectedRestaurant.value = null;
      menu.value = null;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    onMounted(loadDirectory);

    return {
      restaurants,
      selectedRestaurant,
      menu,
      query,
      cuisine,
      cuisineOptions,
      filteredRestaurants,
      loading,
      menuLoading,
      loadError,
      menuError,
      primaryCuisine,
      initials,
      lowestMealPrice,
      selectRestaurant,
      clearSelection,
    };
  },
}).mount('#app');
