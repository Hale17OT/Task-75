<script setup lang="ts">
import CameraCapturePanel from "./CameraCapturePanel.vue";
import FaceImageAnnotator from "./FaceImageAnnotator.vue";
import SectionCard from "./SectionCard.vue";
import type { MemberSummary } from "../types";

defineProps<{
  members: MemberSummary[];
  selectedMemberId: number;
  centerImageBase64: string;
  turnImageBase64: string;
  centerSourceType: "camera" | "import";
  turnSourceType: "camera" | "import";
  centerAnnotation: Record<string, unknown> | null;
  turnAnnotation: Record<string, unknown> | null;
  dedupPreview: Record<string, unknown> | null;
  dedupChecking: boolean;
  challengeIssuedAt: string | null;
  challengeExpiresAt: string | null;
  result: Record<string, unknown> | null;
  history: Array<Record<string, unknown>>;
  auditTrail: Array<Record<string, unknown>>;
  sectionError: string | null;
  sectionSuccess: string | null;
}>();

const emit = defineEmits<{
  "update:selectedMemberId": [value: number];
  "update:centerImageBase64": [value: string];
  "update:turnImageBase64": [value: string];
  "update:centerSourceType": [value: "camera" | "import"];
  "update:turnSourceType": [value: "camera" | "import"];
  "update:centerAnnotation": [value: Record<string, unknown> | null];
  "update:turnAnnotation": [value: Record<string, unknown> | null];
  enroll: [];
  refreshHistory: [];
  deactivate: [faceRecordId: number];
}>();
</script>

<template>
  <SectionCard title="Face enrollment workstation" eyebrow="Biometrics">
    <div class="flex flex-wrap items-center gap-3">
      <select
        :value="selectedMemberId"
        class="min-w-72 rounded-2xl border border-slate-300 px-4 py-3"
        :disabled="members.length <= 1"
        @change="emit('update:selectedMemberId', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="member in members" :key="member.id" :value="member.id">{{ member.fullName }}</option>
      </select>
      <button class="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold" @click="emit('refreshHistory')">Refresh history</button>
    </div>

    <div class="mt-6 grid gap-6 xl:grid-cols-2">
      <div class="space-y-4">
        <CameraCapturePanel
          label="Center capture"
          :model-value="centerImageBase64"
          :source-type="centerSourceType"
          @update:model-value="emit('update:centerImageBase64', $event)"
          @update:source-type="emit('update:centerSourceType', $event)"
        />
        <FaceImageAnnotator :model-value="centerImageBase64" label="Center quality gates" @update="emit('update:centerAnnotation', $event)" />
      </div>
      <div class="space-y-4">
        <CameraCapturePanel
          label="Prompted head turn"
          :model-value="turnImageBase64"
          :source-type="turnSourceType"
          @update:model-value="emit('update:turnImageBase64', $event)"
          @update:source-type="emit('update:turnSourceType', $event)"
        />
        <FaceImageAnnotator :model-value="turnImageBase64" label="Turn quality gates" @update="emit('update:turnAnnotation', $event)" />
      </div>
    </div>

    <div class="mt-6 grid gap-4 md:grid-cols-3">
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Center gate</p>
        <p class="mt-2 text-sm font-semibold text-slate-800">
          {{ (centerAnnotation?.blurScore as number | undefined) && (centerAnnotation?.blurScore as number) >= 12 ? "Passed" : "Needs sharper image" }}
        </p>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Turn gate</p>
        <p class="mt-2 text-sm font-semibold text-slate-800">
          {{ (turnAnnotation?.blurScore as number | undefined) && (turnAnnotation?.blurScore as number) >= 12 ? "Passed" : "Needs sharper image" }}
        </p>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Operator guidance</p>
        <p class="mt-2 text-sm font-semibold text-slate-800">
          {{ centerAnnotation?.faceInFrame && turnAnnotation?.faceInFrame ? "Guidance markers look reasonable" : "Guidance markers are optional but can help operators recapture faster" }}
        </p>
      </div>
    </div>

    <div class="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Timed server challenge</p>
      <p class="mt-2 text-sm font-semibold text-slate-800">
        {{ challengeExpiresAt ? `Active until ${challengeExpiresAt}` : "Capture the center image to start the trusted 30-second head-turn window." }}
      </p>
      <p class="mt-1 text-xs text-slate-500">
        Client landmark clicks remain operator hints only. Final face-in-frame and liveness validation are derived server-side from the uploaded images.
      </p>
      <p v-if="challengeIssuedAt" class="mt-1 text-xs text-slate-500">Challenge issued at {{ challengeIssuedAt }}</p>
    </div>

    <div class="mt-6 flex flex-wrap items-center gap-3">
      <button class="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white" @click="emit('enroll')">Submit face enrollment</button>
      <p class="text-sm text-slate-500">Timed challenge: capture the second head-turn image within 30 seconds of the server-issued center-capture challenge.</p>
      <p v-if="dedupChecking" class="text-sm font-semibold text-slate-500">Checking local duplicate warnings...</p>
      <p v-if="sectionSuccess" class="text-sm font-semibold text-emerald-600">{{ sectionSuccess }}</p>
      <p v-if="sectionError" class="text-sm font-semibold text-rose-600">{{ sectionError }}</p>
    </div>

    <div v-if="dedupPreview" class="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <p class="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">Duplicate warning</p>
      <p v-if="dedupPreview.redacted" class="mt-2 text-sm font-semibold text-amber-900">
        A similar face record exists outside your access scope with similarity {{ dedupPreview.similarity }}.
      </p>
      <p v-else class="mt-2 text-sm font-semibold text-amber-900">
        A similar face record already exists for member {{ dedupPreview.memberUserId }} with similarity
        {{ dedupPreview.similarity }}.
      </p>
      <p class="mt-1 text-xs text-amber-800">Review before final submission. Deactivated records are included in this warning.</p>
    </div>

    <div v-if="result" class="mt-6 grid gap-4 md:grid-cols-3">
      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Blur score</p>
        <p class="mt-2 text-lg font-semibold">{{ result.blurScore }}</p>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Liveness score</p>
        <p class="mt-2 text-lg font-semibold">{{ result.livenessScore }}</p>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Dedup status</p>
        <p class="mt-2 text-sm font-semibold">{{ result.duplicateWarning ? "Duplicate warning raised" : "No duplicates detected" }}</p>
      </div>
    </div>

    <div class="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm font-semibold text-ink">Face record history</p>
        <p class="text-xs text-slate-500">Versioned, soft-deactivated history remains visible for governance.</p>
      </div>
      <div class="mt-4 space-y-3">
        <div v-for="item in history" :key="`${item.faceRecordId}-${item.versionNumber}`" class="rounded-2xl border border-slate-200 bg-white p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-sm font-semibold">Record {{ item.faceRecordId }} · Version {{ item.versionNumber ?? "n/a" }}</p>
              <p class="mt-1 text-xs text-slate-500">Status: {{ item.status }} · Blur: {{ item.blurScore ?? "n/a" }} · Liveness: {{ item.livenessScore ?? "n/a" }}</p>
            </div>
            <button
              v-if="item.status !== 'deactivated'"
              class="rounded-xl border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700"
              @click="emit('deactivate', Number(item.faceRecordId))"
            >
              Deactivate
            </button>
          </div>
        </div>
        <p v-if="history.length === 0" class="text-sm text-slate-500">No face history exists for this member yet.</p>
      </div>
    </div>

    <div class="mt-6 rounded-3xl border border-slate-200 bg-white p-5">
      <p class="text-sm font-semibold text-ink">Biometric audit trail</p>
      <div class="mt-4 space-y-3">
        <div v-for="entry in auditTrail" :key="`${entry.createdAt}-${entry.eventType}`" class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-sm font-semibold">{{ entry.eventType }} · {{ entry.actorName }}</p>
          <p class="mt-1 text-xs text-slate-500">{{ entry.createdAt }}</p>
        </div>
        <p v-if="auditTrail.length === 0" class="text-sm text-slate-500">No biometric audit events exist for this member yet.</p>
      </div>
    </div>
  </SectionCard>
</template>
