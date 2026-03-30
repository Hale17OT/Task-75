<script setup lang="ts">
import { computed, toRefs } from "vue";
import SectionCard from "./SectionCard.vue";
import MetricCard from "./MetricCard.vue";
import type { MemberSummary, SessionUser } from "../types";

const props = defineProps<{
  currentUser: SessionUser;
  stationToken: string;
  hasPin: boolean;
  newPin: string;
  memberSelf: MemberSummary | null;
}>();
const { currentUser, stationToken, hasPin, newPin, memberSelf } = toRefs(props);

const emit = defineEmits<{
  "update:newPin": [value: string];
  savePin: [];
  ownConsent: [status: "granted" | "declined"];
}>();

const pinPattern = /^\d{4,6}$/;
const isPinValid = computed(() => pinPattern.test(props.newPin));
const showPinValidation = computed(() => props.newPin.length > 0 && !isPinValid.value);
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
        inputmode="numeric"
        maxlength="6"
        class="rounded-2xl border border-slate-300 px-4 py-3"
        placeholder="Set 4-6 digit PIN"
        @input="emit('update:newPin', ($event.target as HTMLInputElement).value)"
      />
      <button class="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white" :disabled="!isPinValid" @click="emit('savePin')">Save PIN</button>
    </div>
    <p v-if="showPinValidation" class="text-xs font-semibold text-danger">PIN must be 4 to 6 digits.</p>
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
