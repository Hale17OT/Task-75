<script setup lang="ts">
import SectionCard from "./SectionCard.vue";
import type { SessionUser } from "../types";

defineProps<{
  currentUser: SessionUser | null;
  sessionSecret: string | null;
  hasPin: boolean;
  bootstrapRequired: boolean;
  error: string | null;
  loading: boolean;
  stationToken: string;
  form: {
    username: string;
    password: string;
    pin: string;
    bootstrapFullName: string;
  };
}>();

const emit = defineEmits<{
  "update:stationToken": [value: string];
  login: [];
  reenter: [];
  bootstrap: [];
}>();
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-10">
    <div class="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section class="rounded-[32px] bg-slate-900 p-10 text-white shadow-soft">
        <p class="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">SentinelFit</p>
        <h1 class="mt-4 text-4xl font-semibold leading-tight">Offline Operations Control Center</h1>
        <p class="mt-4 max-w-2xl text-base leading-7 text-slate-200">
          Manage members, coaching content, reports, backups, and biometric governance on-premise.
        </p>
      </section>
      <SectionCard
        :title="bootstrapRequired ? 'First administrator setup' : 'Operator sign-in'"
        eyebrow="Authentication"
      >
        <template v-if="currentUser && hasPin && !sessionSecret">
          <p class="text-sm leading-6 text-slate-600">
            An active workstation session was found for {{ currentUser.username }}. Re-enter the PIN on this same station to resume without a full password sign-in.
          </p>
          <input v-model="form.pin" type="password" class="w-full rounded-2xl border border-slate-300 px-4 py-3" placeholder="PIN" />
          <button class="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white" :disabled="loading" @click="emit('reenter')">
            Resume with PIN
          </button>
        </template>
        <template v-else-if="bootstrapRequired">
          <p class="text-sm leading-6 text-slate-600">
            No administrator exists yet. Create the first administrator to unlock the offline platform on this workstation.
          </p>
          <input v-model="form.bootstrapFullName" class="w-full rounded-2xl border border-slate-300 px-4 py-3" placeholder="Full name" />
          <input v-model="form.username" class="w-full rounded-2xl border border-slate-300 px-4 py-3" placeholder="Administrator username" />
          <input v-model="form.password" type="password" class="w-full rounded-2xl border border-slate-300 px-4 py-3" placeholder="Administrator password" />
          <button class="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white" :disabled="loading" @click="emit('bootstrap')">
            Create administrator
          </button>
        </template>
        <template v-else>
          <input v-model="form.username" class="w-full rounded-2xl border border-slate-300 px-4 py-3" placeholder="Username" />
          <input v-model="form.password" type="password" class="w-full rounded-2xl border border-slate-300 px-4 py-3" placeholder="Password" />
          <button class="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white" :disabled="loading" @click="emit('login')">
            Sign in
          </button>
        </template>
        <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Workstation token</p>
          <input
            :value="stationToken"
            class="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            placeholder="Front-Desk-01"
            @input="emit('update:stationToken', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <p v-if="error" class="text-sm font-semibold text-danger">{{ error }}</p>
      </SectionCard>
    </div>
  </main>
</template>
