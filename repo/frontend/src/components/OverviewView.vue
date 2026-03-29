<script setup lang="ts">
import SectionCard from "./SectionCard.vue";
import MetricCard from "./MetricCard.vue";
import type { MemberSummary, SessionUser } from "../types";

defineProps<{
  currentUser: SessionUser;
  stationToken: string;
  hasPin: boolean;
  newPin: string;
  memberSelf: MemberSummary | null;
}>();

const emit = defineEmits<{
  "update:newPin": [value: string];
  savePin: [];
  ownConsent: [status: "granted" | "declined"];
}>();
</script>

<template>
  <SectionCard title="Operational snapshot" eyebrow="Overview">
    <div class="grid gap-4 md:grid-cols-3">
      <MetricCard label="Roles" :value="currentUser.roles.join(', ')" />
      <MetricCard label="Station token" :value="stationToken" />
      <MetricCard label="PIN enabled" :value="hasPin ? 'Yes' : 'No'" />
    </div>
    <div class="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
      <input
        :value="newPin"
        type="password"
        class="rounded-2xl border border-slate-300 px-4 py-3"
        placeholder="Set 4-6 digit PIN"
        @input="emit('update:newPin', ($event.target as HTMLInputElement).value)"
      />
      <button class="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white" @click="emit('savePin')">Save PIN</button>
    </div>
    <div v-if="memberSelf" class="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <p class="text-sm font-semibold text-ink">My face enrollment consent</p>
      <p class="mt-2 text-sm text-slate-600">
        Current status: <span class="font-semibold">{{ memberSelf.faceConsentStatus }}</span>
      </p>
      <div class="mt-4 flex flex-wrap gap-3">
        <button class="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white" @click="emit('ownConsent', 'granted')">
          Grant my consent
        </button>
        <button class="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold" @click="emit('ownConsent', 'declined')">
          Decline consent
        </button>
      </div>
    </div>
  </SectionCard>
</template>
