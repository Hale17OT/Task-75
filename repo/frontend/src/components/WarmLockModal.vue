<script setup lang="ts">
import { computed, ref } from "vue";

const emit = defineEmits<{
  unlock: [pin: string];
}>();

const pin = ref("");
const pinPattern = /^\d{4,6}$/;
const isPinValid = computed(() => pinPattern.test(pin.value));
const hasPinInput = computed(() => pin.value.length > 0);

const handleUnlock = () => {
  if (!isPinValid.value) {
    return;
  }

  emit("unlock", pin.value);
};
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 px-4">
    <div class="w-full max-w-md rounded-[28px] bg-white p-8 shadow-soft">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Warm Lock</p>
      <h2 class="mt-3 text-2xl font-semibold text-ink">PIN required to resume</h2>
      <p class="mt-3 text-sm leading-6 text-slate-600">
        The workstation was idle long enough to trigger a warm lock. The underlying session is still
        active if you unlock before the full inactivity timeout.
      </p>
      <input
        v-model="pin"
        type="password"
        inputmode="numeric"
        maxlength="6"
        class="mt-6 w-full rounded-2xl border border-slate-300 px-4 py-3 text-lg tracking-[0.3em]"
        placeholder="Enter PIN"
      />
      <p v-if="hasPinInput && !isPinValid" class="mt-2 text-xs font-semibold text-danger">
        PIN must be 4 to 6 digits.
      </p>
      <button
        class="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        :disabled="!isPinValid"
        @click="handleUnlock"
      >
        Resume workstation
      </button>
    </div>
  </div>
</template>
