<script setup lang="ts">
import SectionCard from "./SectionCard.vue";
import type { DashboardTemplate, RecipientSummary, ReportScheduleSummary } from "../types";

withDefaults(defineProps<{
  templates: DashboardTemplate[];
  recipients: RecipientSummary[];
  schedules: ReportScheduleSummary[];
  inbox: Array<Record<string, unknown>>;
  scheduleForm: {
    scheduleName: string;
    cronExpression: string;
    templateId: number;
    scheduleFormat: string;
    generateFormat: string;
    subscriberUserIds: number[];
  };
  sectionError: string | null;
  sectionSuccess: string | null;
  creatingSchedule?: boolean;
  generatingReport?: boolean;
  downloadingInboxId?: number | null;
  lastGeneratedReport: Record<string, unknown> | null;
  lastScheduledReport: Record<string, unknown> | null;
}>(), {
  creatingSchedule: false,
  generatingReport: false,
  downloadingInboxId: null
});

const emit = defineEmits<{
  createSchedule: [];
  generate: [];
  download: [inboxItemId: number];
}>();
</script>

<template>
  <SectionCard title="Scheduled reporting" eyebrow="Reports">
    <div class="grid gap-4 md:grid-cols-3">
      <input v-model="scheduleForm.scheduleName" class="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
      <input v-model="scheduleForm.cronExpression" class="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
      <select v-model="scheduleForm.templateId" class="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
        <option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option>
      </select>
    </div>
    <div class="mt-4">
      <select v-model="scheduleForm.scheduleFormat" class="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
        <option value="csv">Schedule as CSV</option>
        <option value="excel">Schedule as Excel</option>
        <option value="pdf">Schedule as PDF</option>
      </select>
    </div>
    <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Subscriptions</p>
      <div class="mt-3 grid gap-2 md:grid-cols-2">
        <label v-for="recipient in recipients" :key="recipient.id" class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <input v-model="scheduleForm.subscriberUserIds" type="checkbox" :value="recipient.id" />
          <span>{{ recipient.fullName }} ({{ recipient.roles.join(", ") }})</span>
        </label>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap gap-3">
      <button :disabled="creatingSchedule" class="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" @click="emit('createSchedule')">
        {{ creatingSchedule ? "Creating schedule..." : "Create schedule" }}
      </button>
      <select v-model="scheduleForm.generateFormat" class="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
        <option value="csv">CSV</option>
        <option value="excel">Excel</option>
        <option value="pdf">PDF</option>
      </select>
      <button :disabled="generatingReport" class="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60" @click="emit('generate')">
        {{ generatingReport ? "Generating..." : "Generate now" }}
      </button>
      <p v-if="sectionSuccess" class="text-sm font-semibold text-emerald-600">{{ sectionSuccess }}</p>
      <p v-if="sectionError" class="text-sm font-semibold text-rose-600">{{ sectionError }}</p>
    </div>

    <div class="mt-6 grid gap-6 xl:grid-cols-2">
      <div class="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Recent schedule result</p>
        <p class="mt-2 text-sm text-slate-600">{{ lastScheduledReport ? "Schedule saved and subscriptions persisted." : "Create a schedule to enable weekly offline reporting." }}</p>
        <div v-if="lastScheduledReport" class="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          {{ lastScheduledReport.name }} | {{ lastScheduledReport.cronExpression }}
        </div>
      </div>
      <div class="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Recent generation result</p>
        <p class="mt-2 text-sm text-slate-600">{{ lastGeneratedReport ? "Latest export was generated for the inbox and shared folder." : "Generate a report to verify exports and delivery." }}</p>
        <div v-if="lastGeneratedReport" class="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          Export {{ lastGeneratedReport.exportId }} | {{ lastGeneratedReport.sharedFilePath ? "Shared delivery passed" : "Shared delivery pending or failed" }}
        </div>
      </div>
    </div>

    <div class="mt-6 rounded-3xl border border-slate-200 bg-white p-5">
      <p class="text-sm font-semibold text-ink">Saved schedules</p>
      <div class="mt-4 space-y-3">
        <div v-for="schedule in schedules" :key="schedule.id" class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-sm font-semibold">{{ schedule.name }}</p>
          <p class="mt-1 text-xs text-slate-500">
            {{ schedule.cronExpression }} | {{ schedule.exportFormat.toUpperCase() }} | Subscribers: {{ schedule.subscriberUserIds.length }} | Last run: {{ schedule.lastRunAt ?? "Never" }}
          </p>
        </div>
      </div>
    </div>

    <div class="mt-6 rounded-3xl border border-slate-200 bg-white p-5">
      <p class="text-sm font-semibold text-ink">Inbox delivery</p>
      <div class="mt-4 space-y-3">
        <div v-for="item in inbox" :key="item.id as number" class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p class="text-sm font-semibold">{{ item.title }}</p>
            <p class="mt-1 text-xs text-slate-500">{{ item.fileName }} | {{ item.status }}</p>
          </div>
          <button :disabled="downloadingInboxId === (item.id as number)" class="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60" @click="emit('download', item.id as number)">
            {{ downloadingInboxId === (item.id as number) ? "Downloading..." : "Download" }}
          </button>
        </div>
      </div>
    </div>
  </SectionCard>
</template>
