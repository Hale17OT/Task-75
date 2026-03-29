<script setup lang="ts">
import SectionCard from "./SectionCard.vue";
import type { ReportInboxItem } from "../types";

withDefaults(defineProps<{
  inbox: ReportInboxItem[];
  downloadingInboxId?: number | null;
}>(), {
  downloadingInboxId: null
});

const emit = defineEmits<{
  download: [inboxItemId: number];
}>();
</script>

<template>
  <SectionCard title="Report inbox" eyebrow="Inbox">
    <div class="space-y-3">
      <div
        v-for="item in inbox"
        :key="item.id"
        class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between"
      >
        <div>
          <p class="text-lg font-semibold">{{ item.title }}</p>
          <p class="mt-2 text-sm text-slate-600">
            {{ item.fileName }} - {{ item.status }} -
            {{ item.status === "completed" ? "Shared folder synced" : "Shared folder issue" }}
          </p>
        </div>
        <button :disabled="downloadingInboxId === item.id" class="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60" @click="emit('download', item.id)">
          {{ downloadingInboxId === item.id ? "Downloading..." : "Download file" }}
        </button>
      </div>
      <p v-if="inbox.length === 0" class="text-sm text-slate-500">Scheduled and ad-hoc report deliveries will appear here.</p>
    </div>
  </SectionCard>
</template>
