<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
  accent?: string;
}>();
</script>

<template>
  <div class="rounded-3xl border border-slate-200 bg-slate-50 p-5">
    <p class="text-sm font-semibold uppercase tracking-[0.12em] text-muted">{{ label }}</p>
    <p class="mt-3 text-3xl font-semibold text-ink" :style="{ color: accent ?? 'var(--color-ink)' }">
      {{ value }}
    </p>
  </div>
</template>

