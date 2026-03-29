<script setup lang="ts">
import BarChart from "./BarChart.vue";
import SectionCard from "./SectionCard.vue";

defineProps<{
  filters: {
    startDateText: string;
    endDateText: string;
    locationCode: string;
    includeHistorical: boolean;
  };
  analytics: Record<string, unknown> | null;
  drilldownTitle: string;
  drilldownRows: Array<{ label: string; value: string | number }>;
  sectionError: string | null;
  sectionSuccess: string | null;
  chartData: {
    stations: Array<{ stationToken: string; views: number }>;
    posts: Array<{ title: string; views: number }>;
    searches: Array<{ term: string; uses: number }>;
  };
}>();

const emit = defineEmits<{
  refresh: [];
  selectStation: [index: number];
  selectPost: [index: number];
  selectSearch: [index: number];
}>();
</script>

<template>
  <SectionCard title="Content analytics" eyebrow="Analytics">
    <div class="grid gap-4 md:grid-cols-4">
      <input v-model="filters.startDateText" class="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="MM/DD/YYYY start" />
      <input v-model="filters.endDateText" class="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="MM/DD/YYYY end" />
      <input v-model="filters.locationCode" class="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Location code" />
      <label class="flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold"><input v-model="filters.includeHistorical" type="checkbox" /> Historical data</label>
    </div>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button class="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white" @click="emit('refresh')">Refresh analytics</button>
      <p v-if="sectionSuccess" class="text-sm font-semibold text-emerald-600">{{ sectionSuccess }}</p>
      <p v-if="sectionError" class="text-sm font-semibold text-rose-600">{{ sectionError }}</p>
    </div>

    <div class="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]" v-if="analytics">
      <div class="grid gap-6 xl:grid-cols-3">
        <div class="rounded-3xl border border-slate-200 bg-white p-4">
          <BarChart
            :labels="chartData.stations.map((item) => item.stationToken)"
            :values="chartData.stations.map((item) => item.views)"
            color="#0f6cbd"
            title="Views by station"
            @select="emit('selectStation', $event.index)"
          />
        </div>
        <div class="rounded-3xl border border-slate-200 bg-white p-4">
          <BarChart
            :labels="chartData.posts.map((item) => item.title)"
            :values="chartData.posts.map((item) => item.views)"
            color="#15803d"
            title="Top posts"
            @select="emit('selectPost', $event.index)"
          />
        </div>
        <div class="rounded-3xl border border-slate-200 bg-white p-4">
          <BarChart
            :labels="chartData.searches.map((item) => item.term)"
            :values="chartData.searches.map((item) => item.uses)"
            color="#b45309"
            title="Search trends"
            @select="emit('selectSearch', $event.index)"
          />
        </div>
      </div>

      <div class="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Drill-down</p>
        <h3 class="mt-2 text-xl font-semibold text-ink">{{ drilldownTitle }}</h3>
        <div class="mt-4 space-y-3">
          <div v-for="row in drilldownRows" :key="`${row.label}-${row.value}`" class="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p class="text-sm font-semibold text-ink">{{ row.label }}</p>
            <p class="mt-1 text-sm text-slate-600">{{ row.value }}</p>
          </div>
          <p v-if="drilldownRows.length === 0" class="text-sm text-slate-500">Select a chart bar to inspect the linked detail without leaving the page.</p>
        </div>
      </div>
    </div>
  </SectionCard>
</template>
