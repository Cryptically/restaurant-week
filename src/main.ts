import './styles.css';
import { computed, createApp, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Restaurant, RestaurantMenu } from './client.js';
import { RestaurantMenuViewModel, RestaurantViewModel } from './view-models.js';

createApp({
  setup() {
    const restaurants = ref([]);
    const menuFiles = ref({});
    const menuDataBase = ref('./data/');
    const selectedRestaurant = ref(null);
    const menu = ref(null);
    const scoreEntries = ref({});
    const classificationsByRestaurantId = ref({});
    const activeMealIndex = ref(0);
    const selectedCriteria = ref([]);
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
    const scoreLoading = ref(false);
    const scoreLoadProgress = ref(0);
    const scoreError = ref('');
    const detailBackButton = ref(null);
    const isMobileLayout = ref(false);
    let pageOverflow = '';
    let rootOverflow = '';
    let restoringFiltersFromUrl = false;
    const classificationLoads = new Map();
    let allClassificationsLoad = null;
    const readableRubricVersions = new Set(['menu-food-variety-v3', 'menu-food-variety-v4']);
    const readablePromptVersions = new Set(['menu-item-classifier-v3', 'menu-item-classifier-v4']);

    const foodCriteria = [
      { id: 'fish', label: 'Fish' },
      { id: 'shellfish', label: 'Shellfish' },
      { id: 'beef', label: 'Beef' },
      { id: 'pork', label: 'Pork' },
      { id: 'poultry', label: 'Poultry' },
      { id: 'lamb_goat', label: 'Lamb' },
      { id: 'vegetarian', label: 'Vegetarian' },
    ];

    // Saved v3 results can contain uncertain; it is a non-match until the classifier is migrated.
    const knownFindingStatuses = new Set(['present', 'absent', 'uncertain']);

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

    const restaurantMatchScores = computed(() => Object.fromEntries(
      Object.entries(classificationsByRestaurantId.value as Record<string, any>).map(([restaurantId, classification]) => {
        const meals = (classification.meals || [])
          .map((meal) => ({ meal, match: matchForMealData(meal) }))
          .filter((entry) => entry.match != null)
          .sort((left, right) => right.match.score - left.match.score || right.match.matched - left.match.matched);
        const best = meals[0];
        return [restaurantId, best ? {
          ...best.match,
          mealLabel: best.meal.title || best.meal.mealType || 'Menu',
        } : null];
      }),
    ));

    const activeClassificationMeal = computed(() => (
      classificationsByRestaurantId.value[String(selectedRestaurant.value?.id)]?.meals?.[activeMealIndex.value] ?? null
    ));
    const activeMealMatch = computed(() => matchForMealData(activeClassificationMeal.value));
    const activeMealMatchScore = computed(() => activeMealMatch.value?.score ?? null);
    const activeMealMatchSummary = computed(() => activeMealMatch.value
      ? `${activeMealMatch.value.matched}/${activeMealMatch.value.total} courses`
      : 'Match unavailable');
    const scoreEntryCount = computed(() => Object.keys(scoreEntries.value).length);

    const sortOptions = computed(() => [
      { value: 'featured', label: 'Featured' },
      { value: 'rating', label: 'Rating' },
      ...(selectedCriteria.value.length ? [{ value: 'match-high', label: 'Match score: high to low' }] : []),
      { value: 'price-low', label: 'Price: low to high' },
      { value: 'price-high', label: 'Price: high to low' },
      { value: 'name-asc', label: 'Name: A–Z' },
      { value: 'name-desc', label: 'Name: Z–A' },
    ]);

    watch(() => selectedCriteria.value.length, (count, previousCount) => {
      if (restoringFiltersFromUrl) return;
      if (count) {
        if (!previousCount) sortBy.value = 'match-high';
        loadAllClassifications();
      } else if (sortBy.value === 'match-high') {
        sortBy.value = 'featured';
      }
    }, { flush: 'sync' });

    watch(() => [
      query.value, cuisine.value, mealType.value, location.value,
      tag.value, priceLevel.value, selectedCriteria.value.join(','), sortBy.value,
    ], updateFilterUrl, { flush: 'sync' });

    const hasActiveFilters = computed(() => Boolean(
      query.value
      || cuisine.value
      || mealType.value
      || location.value
      || tag.value
      || priceLevel.value
      || selectedCriteria.value.length
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
        if (sortBy.value === 'match-high') {
          const rightMatch = restaurantMatchScores.value[String(right.id)];
          const leftMatch = restaurantMatchScores.value[String(left.id)];
          return (rightMatch?.score ?? -1) - (leftMatch?.score ?? -1)
            || left.lowestMealPriceValue - right.lowestMealPriceValue
            || (rightMatch?.matched ?? -1) - (leftMatch?.matched ?? -1)
            || left.name.localeCompare(right.name);
        }
        if (sortBy.value === 'rating') {
          return (right.rating || -Infinity) - (left.rating || -Infinity)
            || left.lowestMealPriceValue - right.lowestMealPriceValue
            || left.name.localeCompare(right.name);
        }
        if (sortBy.value === 'price-low') {
          return left.lowestMealPriceValue - right.lowestMealPriceValue
            || left.name.localeCompare(right.name);
        }
        if (sortBy.value === 'price-high') {
          return right.lowestMealPriceValue - left.lowestMealPriceValue
            || left.name.localeCompare(right.name);
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
      restoringFiltersFromUrl = true;
      try {
        query.value = '';
        cuisine.value = '';
        mealType.value = '';
        location.value = '';
        tag.value = '';
        priceLevel.value = '';
        selectedCriteria.value = [];
        sortBy.value = 'featured';
      } finally {
        restoringFiltersFromUrl = false;
      }
      updateFilterUrl();
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

    function matchForFindings(findings) {
      if (!selectedCriteria.value.length || !findings) return null;
      const statuses = selectedCriteria.value.map((id) => findings[id]?.status);
      if (statuses.some((status) => !knownFindingStatuses.has(status))) return null;
      return statuses.includes('present');
    }

    function matchForSectionData(section) {
      if (!selectedCriteria.value.length || !section?.items?.length) return null;
      const itemMatches = section.items.map((item) => matchForFindings(item.classifications));
      if (itemMatches.some((match) => match == null)) return null;
      return itemMatches.includes(true);
    }

    function matchForMealData(meal) {
      if (!meal?.sections?.length) return null;
      const sectionMatches = meal.sections.map(matchForSectionData);
      if (sectionMatches.some((match) => match == null)) return null;
      const matched = sectionMatches.filter(Boolean).length;
      const total = sectionMatches.length;
      return { matched, total, score: Number((matched / total * 100).toFixed(1)) };
    }

    function mealMatchScore(mealIndex) {
      const meal = classificationsByRestaurantId.value[String(selectedRestaurant.value?.id)]?.meals?.[mealIndex];
      return matchForMealData(meal)?.score ?? null;
    }

    function sectionMatchScore(sectionIndex) {
      const match = matchForSectionData(activeClassificationMeal.value?.sections?.[sectionIndex]);
      return match == null ? null : match ? 100 : 0;
    }

    function itemClassification(sectionIndex, itemIndex) {
      return activeClassificationMeal.value?.sections?.[sectionIndex]?.items?.[itemIndex] ?? null;
    }

    function itemMatchScore(sectionIndex, itemIndex) {
      const match = matchForFindings(itemClassification(sectionIndex, itemIndex)?.classifications);
      return match == null ? null : match ? 100 : 0;
    }

    function itemFindings(sectionIndex, itemIndex) {
      const classifications = itemClassification(sectionIndex, itemIndex)?.classifications;
      if (!classifications) return [];
      return selectedCriteria.value.map((id) => {
        const finding = classifications[id];
        const status = finding?.status === 'present' ? 'present'
          : finding?.status && knownFindingStatuses.has(finding.status) ? 'absent' : 'unavailable';
        return {
          id,
          label: foodCriteria.find((criterion) => criterion.id === id)?.label ?? id,
          status,
          statusLabel: ({ present: 'Listed', absent: 'Not indicated', unavailable: 'Unavailable' })[status],
          evidence: status === 'present' ? finding.evidence ?? null : null,
        };
      });
    }

    function itemMatchSummary(sectionIndex, itemIndex) {
      const findings = itemFindings(sectionIndex, itemIndex);
      if (!findings.length) return scoreLoading.value ? 'Loading scores…' : 'Score unavailable';
      if (findings.some(({ status }) => status === 'unavailable')) return 'Match unavailable';
      if (findings.length === 1) return `${findings[0].label}: ${findings[0].statusLabel.toLowerCase()}`;
      const found = findings.filter(({ status }) => status === 'present').map(({ label }) => label);
      return found.length ? `${found.join(', ')} listed` : 'No selected foods listed';
    }

    function formatMatch(score) {
      return score == null ? 'Unavailable' : score > 0 ? 'Match' : 'No match';
    }

    function formatScore(score) {
      return score == null ? '—' : `${Math.round(score)}%`;
    }

    function scoreTone(score) {
      if (score == null) return 'score-unavailable';
      if (score >= 70) return 'score-strong';
      if (score >= 40) return 'score-mixed';
      return 'score-low';
    }

    function restaurantMatch(restaurantId) {
      return restaurantMatchScores.value[String(restaurantId)] ?? null;
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

    function syncFiltersFromUrl() {
      const params = new URL(window.location.href).searchParams;
      const requestedFoods = new Set(params.getAll('food'));
      const foods = foodCriteria.map(({ id }) => id).filter((id) => requestedFoods.has(id));
      const requestedSort = params.get('sort');
      const validSorts = new Set(['featured', 'rating', 'match-high', 'price-low', 'price-high', 'name-asc', 'name-desc']);

      restoringFiltersFromUrl = true;
      try {
        query.value = params.get('q') ?? '';
        cuisine.value = params.get('cuisine') ?? '';
        mealType.value = params.get('mealType') ?? '';
        location.value = params.get('location') ?? '';
        tag.value = params.get('tag') ?? '';
        priceLevel.value = params.get('priceLevel') ?? '';
        selectedCriteria.value = foods;
        sortBy.value = validSorts.has(requestedSort) && (foods.length || requestedSort !== 'match-high')
          ? requestedSort : foods.length ? 'match-high' : 'featured';
      } finally {
        restoringFiltersFromUrl = false;
      }
    }

    function updateFilterUrl() {
      if (restoringFiltersFromUrl) return;
      const url = new URL(window.location.href);
      const fields = [
        ['q', query.value], ['cuisine', cuisine.value], ['mealType', mealType.value],
        ['location', location.value], ['tag', tag.value], ['priceLevel', priceLevel.value],
      ];
      for (const [key, value] of fields) {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      url.searchParams.delete('food');
      for (const { id } of foodCriteria) {
        if (selectedCriteria.value.includes(id)) url.searchParams.append('food', id);
      }
      if (sortBy.value === 'featured') url.searchParams.delete('sort');
      else url.searchParams.set('sort', sortBy.value);

      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, '', nextUrl);
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
      syncFiltersFromUrl();
      if (selectedCriteria.value.length) loadAllClassifications();
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
        const [restaurantResponse, indexResponse, scoreIndexResponse] = await Promise.all([
          fetch(`${menuDataBase.value}restaurants/restaurants.json`),
          fetch(`${menuDataBase.value}menus/index.json`),
          fetch(`${menuDataBase.value}scores/index.json`),
        ]);

        if (!restaurantResponse.ok || !indexResponse.ok) {
          throw new Error('The published data files could not be found.');
        }

        const [restaurantData, indexData, scoreIndexData] = await Promise.all([
          restaurantResponse.json(),
          indexResponse.json(),
          scoreIndexResponse.ok ? scoreIndexResponse.json() : Promise.resolve({ byRestaurantId: {} }),
        ]);

        restaurants.value = restaurantData.map(
          (item) => new RestaurantViewModel(new Restaurant(item)),
        );
        menuFiles.value = indexData;
        scoreEntries.value = scoreIndexData.byRestaurantId || {};
        if (selectedCriteria.value.length) loadAllClassifications();

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

    async function loadClassification(restaurantId) {
      const id = String(restaurantId);
      const entry = scoreEntries.value[id];
      if (!entry || typeof entry.classificationFile !== 'string'
        || entry.classificationFile.includes('..')
        || entry.classificationFile.includes('/')
        || entry.classificationFile.includes('\\')) {
        throw new Error('No current menu classification is available.');
      }
      if (!readableRubricVersions.has(entry.rubricVersion) || !readablePromptVersions.has(entry.promptVersion)) {
        const error = new Error('Menu classifications need updating for the current rubric.');
        error.name = 'StaleClassificationError';
        throw error;
      }

      const cached = classificationsByRestaurantId.value[id];
      if (cached?.menuHash === entry.menuHash && cached?.promptVersion === entry.promptVersion) return cached;
      if (classificationLoads.has(id)) return classificationLoads.get(id);

      const request = (async () => {
        const response = await fetch(`${menuDataBase.value}scores/${encodeURIComponent(entry.classificationFile)}`);
        if (!response.ok) throw new Error(`Could not load menu classifications (${response.status}).`);
        const classification = await response.json();
        if (String(classification.restaurantId) !== id || classification.menuHash !== entry.menuHash) {
          throw new Error('The saved classification does not match this restaurant’s current menu.');
        }
        if (classification.rubricVersion !== entry.rubricVersion
          || classification.promptVersion !== entry.promptVersion) {
          const error = new Error('Menu classifications need updating for the current rubric.');
          error.name = 'StaleClassificationError';
          throw error;
        }
        classificationsByRestaurantId.value = {
          ...classificationsByRestaurantId.value,
          [id]: classification,
        };
        return classification;
      })();

      classificationLoads.set(id, request);
      try {
        return await request;
      } finally {
        classificationLoads.delete(id);
      }
    }

    async function loadAllClassifications() {
      if (allClassificationsLoad) return allClassificationsLoad;

      allClassificationsLoad = (async () => {
        const ids = Object.keys(scoreEntries.value);
        if (!ids.length) {
          scoreError.value = 'Menu classifications are not available.';
          return;
        }

        scoreLoading.value = true;
        scoreLoadProgress.value = 0;
        scoreError.value = '';
        const failedIds = [];
        let staleCount = 0;
        let nextIndex = 0;
        const workerCount = Math.min(8, ids.length);

        await Promise.all(Array.from({ length: workerCount }, async () => {
          while (nextIndex < ids.length) {
            const id = ids[nextIndex];
            nextIndex += 1;
            try {
              await loadClassification(id);
            } catch (error) {
              failedIds.push(id);
              if (error.name === 'StaleClassificationError') staleCount += 1;
            } finally {
              scoreLoadProgress.value += 1;
            }
          }
        }));

        if (failedIds.length) {
          scoreError.value = staleCount
            ? `Saved menu scores need refreshing for the current rubric (${staleCount} menu${staleCount === 1 ? '' : 's'}).`
            : `Could not load scores for ${failedIds.length} menu${failedIds.length === 1 ? '' : 's'}.`;
        }
      })();

      try {
        await allClassificationsLoad;
      } finally {
        allClassificationsLoad = null;
        scoreLoading.value = false;
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

        const response = await fetch(`${menuDataBase.value}menus/${encodeURIComponent(filename)}`);

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
      syncFiltersFromUrl();
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
      mealType,
      location,
      tag,
      priceLevel,
      sortBy,
      foodCriteria,
      selectedCriteria,
      scoreLoading,
      scoreLoadProgress,
      scoreError,
      scoreEntries,
      scoreEntryCount,
      classificationsByRestaurantId,
      restaurantMatch,
      activeMealMatchScore,
      activeMealMatchSummary,
      mealMatchScore,
      sectionMatchScore,
      itemMatchScore,
      itemFindings,
      itemMatchSummary,
      formatScore,
      formatMatch,
      scoreTone,
      cuisineOptions,
      mealTypeOptions,
      locationOptions,
      tagOptions,
      priceLevelOptions,
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
