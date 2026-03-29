<script setup lang="ts">
import MetricCard from "./MetricCard.vue";
import SectionCard from "./SectionCard.vue";
import type { AdminConsole } from "../types";

defineProps<{
  consoleData: AdminConsole | null;
  backupResult: Record<string, unknown> | null;
  recoveryResult: Record<string, unknown> | null;
  dryRunBackupId: string;
  loadingBackup: boolean;
  loadingRecovery: boolean;
  sectionError: string | null;
}>();

const emit = defineEmits<{
  "update:dryRunBackupId": [value: string];
  backup: [];
  dryRun: [];
}>();
</script>

<template>
  <SectionCard title="Observability and recovery" eyebrow="Admin Console">
    <div class="grid gap-4 md:grid-cols-3" v-if="consoleData">
      <MetricCard label="Total logs" :value="consoleData.metrics.totalLogs" />
      <MetricCard label="Open alerts" :value="consoleData.metrics.openAlerts" />
      <MetricCard label="Uptime" :value="consoleData.metrics.uptimeSeconds" />
      <MetricCard label="Avg latency" :value="`${consoleData.metrics.averageRequestDurationMs.toFixed(1)} ms`" />
      <MetricCard label="Error rate" :value="`${(consoleData.metrics.serverErrorRate * 100).toFixed(1)}%`" />
      <MetricCard label="Last backup" :value="`${consoleData.metrics.lastBackupDurationMs.toFixed(0)} ms`" />
    </div>
    <div class="mt-4 flex flex-wrap gap-3">
      <button class="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" :disabled="loadingBackup" @click="emit('backup')">
        {{ loadingBackup ? "Running backup..." : "Run backup" }}
      </button>
      <input :value="dryRunBackupId" class="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Backup run id" @input="emit('update:dryRunBackupId', ($event.target as HTMLInputElement).value)" />
      <button class="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60" :disabled="loadingRecovery || !dryRunBackupId" @click="emit('dryRun')">
        {{ loadingRecovery ? "Validating restore..." : "Dry-run restore" }}
      </button>
    </div>

    <p v-if="sectionError" class="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
      {{ sectionError }}
    </p>

    <div class="mt-6 grid gap-6 xl:grid-cols-2">
      <div class="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <p class="text-sm font-semibold text-ink">Latest backup</p>
        <div v-if="backupResult" class="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <p>ID: {{ backupResult.id }}</p>
          <p class="mt-1">Checksum: {{ backupResult.checksum }}</p>
        </div>
      </div>
      <div class="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <p class="text-sm font-semibold text-ink">Latest dry-run restore</p>
        <div v-if="recoveryResult" class="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <p>Status: {{ recoveryResult.status }}</p>
          <p class="mt-1">Checksum: {{ recoveryResult.checksum ?? "n/a" }}</p>
        </div>
      </div>
    </div>

    <div class="mt-6 grid gap-6 xl:grid-cols-2" v-if="consoleData">
      <div class="rounded-3xl border border-slate-200 bg-white p-5">
        <p class="text-sm font-semibold text-ink">Recent logs</p>
        <div class="mt-4 space-y-3">
          <div v-for="entry in consoleData.recentLogs" :key="`${entry.createdAt}-${entry.message}`" class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p class="text-sm font-semibold">{{ entry.category }} · {{ entry.level }}</p>
            <p class="mt-1 text-sm text-slate-600">{{ entry.message }}</p>
          </div>
        </div>
      </div>
      <div class="rounded-3xl border border-slate-200 bg-white p-5">
        <p class="text-sm font-semibold text-ink">Recent alerts</p>
        <div class="mt-4 space-y-3">
          <div v-for="entry in consoleData.recentAlerts" :key="`${entry.createdAt}-${entry.message}`" class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p class="text-sm font-semibold">{{ entry.alertType }} · {{ entry.severity }}</p>
            <p class="mt-1 text-sm text-slate-600">{{ entry.message }}</p>
          </div>
          <p v-if="consoleData.recentAlerts.length === 0" class="text-sm text-slate-500">No open anomaly alerts are currently surfaced.</p>
        </div>
      </div>
    </div>
  </SectionCard>
</template>
