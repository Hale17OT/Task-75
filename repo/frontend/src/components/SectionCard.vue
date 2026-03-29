<script setup lang="ts">
defineProps<{
  title: string;
  eyebrow?: string;
}>();
</script>

<template>
  <section class="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft">
    <p v-if="eyebrow" class="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
      {{ eyebrow }}
    </p>
    <h2 class="mt-2 text-2xl font-semibold text-ink">{{ title }}</h2>
    <div class="mt-5 space-y-4">
      <slot />
    </div>
  </section>
</template>

