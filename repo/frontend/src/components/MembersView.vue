<script setup lang="ts">
import SectionCard from "./SectionCard.vue";
import type { CoachSummary, MemberSummary } from "../types";

withDefaults(defineProps<{
  members: MemberSummary[];
  coaches: CoachSummary[];
  form: {
    username: string;
    fullName: string;
    password: string;
    phone: string;
    locationCode: string;
    notes: string;
    coachUserId: number | null;
  };
  creating?: boolean;
  assigningMemberId?: number | null;
  consentingMemberId?: number | null;
  sectionError: string | null;
  sectionSuccess: string | null;
}>(), {
  creating: false,
  assigningMemberId: null,
  consentingMemberId: null
});

const emit = defineEmits<{
  create: [];
  assignCoach: [memberId: number, coachUserId: number];
  consent: [memberId: number, status: "granted" | "declined"];
}>();
</script>

<template>
  <SectionCard title="Member enrollment" eyebrow="Members">
    <div class="grid gap-4 md:grid-cols-2">
      <input v-model="form.username" class="rounded-2xl border border-slate-300 px-4 py-3" placeholder="Username" />
      <input v-model="form.fullName" class="rounded-2xl border border-slate-300 px-4 py-3" placeholder="Full name" />
      <input v-model="form.password" type="password" class="rounded-2xl border border-slate-300 px-4 py-3" placeholder="Temporary password (required)" />
      <input v-model="form.phone" class="rounded-2xl border border-slate-300 px-4 py-3" placeholder="Phone number" />
      <input v-model="form.locationCode" class="rounded-2xl border border-slate-300 px-4 py-3" placeholder="Location code" />
      <select v-model="form.coachUserId" class="rounded-2xl border border-slate-300 px-4 py-3">
        <option :value="null">Assign coach later</option>
        <option v-for="coach in coaches" :key="coach.id" :value="coach.id">{{ coach.fullName }}</option>
      </select>
    </div>
    <textarea v-model="form.notes" class="mt-4 min-h-24 w-full rounded-2xl border border-slate-300 px-4 py-3" placeholder="Enrollment notes"></textarea>
    <p class="mt-3 text-xs font-medium text-slate-500">Member passwords are never pre-filled. Enter a unique password for each enrollment.</p>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button :disabled="creating" class="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" @click="emit('create')">
        {{ creating ? "Creating member..." : "Create member" }}
      </button>
      <p v-if="sectionSuccess" class="text-sm font-semibold text-emerald-600">{{ sectionSuccess }}</p>
      <p v-if="sectionError" class="text-sm font-semibold text-rose-600">{{ sectionError }}</p>
    </div>

    <div class="mt-6 space-y-3">
      <div v-for="member in members" :key="member.id" class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p class="text-lg font-semibold">{{ member.fullName }}</p>
            <p class="text-sm text-slate-600">{{ member.username }} · {{ member.phoneMasked ?? "No phone" }}</p>
            <p class="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Consent: {{ member.faceConsentStatus }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <select
              class="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
              :value="member.coachUserId ?? ''"
              :disabled="assigningMemberId === member.id"
              @change="emit('assignCoach', member.id, Number(($event.target as HTMLSelectElement).value))"
            >
              <option disabled value="">Assign coach</option>
              <option v-for="coach in coaches" :key="coach.id" :value="coach.id">{{ coach.fullName }}</option>
            </select>
            <button :disabled="consentingMemberId === member.id" class="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60" @click="emit('consent', member.id, 'granted')">
              Grant face consent
            </button>
            <button :disabled="consentingMemberId === member.id" class="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60" @click="emit('consent', member.id, 'declined')">
              Decline consent
            </button>
          </div>
        </div>
      </div>
    </div>
  </SectionCard>
</template>
