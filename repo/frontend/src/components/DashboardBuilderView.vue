<script setup lang="ts">
import SectionCard from "./SectionCard.vue";
import type { DashboardWidget } from "../types";

withDefaults(defineProps<{
  widgetPalette: Array<{ widgetType: string; title: string }>;
  layout: DashboardWidget[];
  templateName: string;
  savingLayout?: boolean;
  savingTemplate?: boolean;
  sectionError: string | null;
  sectionSuccess: string | null;
}>(), {
  savingLayout: false,
  savingTemplate: false
});

const emit = defineEmits<{
  addWidget: [widgetType: string, title: string];
  moveWidget: [fromIndex: number, toIndex: number];
  removeWidget: [widgetId: string];
  updateWidgetTitle: [widgetId: string, title: string];
  "update:templateName": [value: string];
  saveLayout: [];
  saveTemplate: [];
}>();
</script>

<template>
  <SectionCard title="Dashboard builder" eyebrow="Dashboards">
    <div class="grid gap-3 md:grid-cols-3">
      <button
        v-for="widget in widgetPalette"
        :key="widget.widgetType"
        class="rounded-2xl border border-slate-300 px-4 py-3 text-left text-sm font-semibold"
        @click="emit('addWidget', widget.widgetType, widget.title)"
      >
        Add {{ widget.title }}
      </button>
    </div>
    <div class="grid gap-3 md:grid-cols-2">
      <div
        v-for="(widget, index) in layout"
        :key="widget.id"
        draggable="true"
        class="rounded-2xl border border-slate-200 bg-slate-50 p-4"
        @dragstart="($event.dataTransfer?.setData('text/plain', String(index)))"
        @dragover.prevent
        @drop="emit('moveWidget', Number($event.dataTransfer?.getData('text/plain') ?? index), index)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="w-full space-y-2">
            <input
              :value="widget.title ?? widget.widgetType ?? widget.id"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              @input="emit('updateWidgetTitle', widget.id, ($event.target as HTMLInputElement).value)"
            />
            <p class="text-xs text-slate-500">{{ widget.widgetType ?? widget.id }} · x={{ widget.x }}, y={{ widget.y }}</p>
          </div>
          <button class="rounded-xl border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700" @click="emit('removeWidget', widget.id)">
            Remove
          </button>
        </div>
      </div>
    </div>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button :disabled="savingLayout" class="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" @click="emit('saveLayout')">
        {{ savingLayout ? "Saving layout..." : "Save layout" }}
      </button>
      <input
        :value="templateName"
        class="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
        placeholder="Template name"
        @input="emit('update:templateName', ($event.target as HTMLInputElement).value)"
      />
      <button :disabled="savingTemplate" class="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60" @click="emit('saveTemplate')">
        {{ savingTemplate ? "Saving template..." : "Save template" }}
      </button>
      <p v-if="sectionSuccess" class="text-sm font-semibold text-emerald-600">{{ sectionSuccess }}</p>
      <p v-if="sectionError" class="text-sm font-semibold text-rose-600">{{ sectionError }}</p>
    </div>
  </SectionCard>
</template>
