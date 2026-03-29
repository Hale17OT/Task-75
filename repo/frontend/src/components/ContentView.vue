<script setup lang="ts">
import SectionCard from "./SectionCard.vue";
import type { ContentPost } from "../types";

withDefaults(defineProps<{
  postForm: {
    kind: string;
    title: string;
    body: string;
    locationCode: string;
  };
  posts: ContentPost[];
  searchTerm: string;
  selectedPostId: number | null;
  publishing?: boolean;
  searching?: boolean;
  refreshingAnalytics?: boolean;
  viewingPostId?: number | null;
  sectionError: string | null;
  sectionSuccess: string | null;
}>(), {
  publishing: false,
  searching: false,
  refreshingAnalytics: false,
  viewingPostId: null
});

const emit = defineEmits<{
  publish: [];
  "update:searchTerm": [value: string];
  search: [];
  view: [postId: number, locationCode: string];
}>();
</script>

<template>
  <SectionCard title="Coach publishing" eyebrow="Content">
    <div class="grid gap-4 md:grid-cols-2">
      <input v-model="postForm.title" class="rounded-2xl border border-slate-300 px-4 py-3" placeholder="Title" />
      <select v-model="postForm.kind" class="rounded-2xl border border-slate-300 px-4 py-3">
        <option value="tip">Training tip</option>
        <option value="announcement">Announcement</option>
      </select>
    </div>
    <textarea v-model="postForm.body" class="mt-4 min-h-32 w-full rounded-2xl border border-slate-300 px-4 py-3" placeholder="Post body"></textarea>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button :disabled="publishing" class="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" @click="emit('publish')">
        {{ publishing ? "Publishing..." : "Publish post" }}
      </button>
      <p v-if="sectionSuccess" class="text-sm font-semibold text-emerald-600">{{ sectionSuccess }}</p>
      <p v-if="sectionError" class="text-sm font-semibold text-rose-600">{{ sectionError }}</p>
    </div>
    <div class="mt-6 grid gap-4 md:grid-cols-[1fr_auto]">
      <input
        :value="searchTerm"
        class="rounded-2xl border border-slate-300 px-4 py-3"
        placeholder="Record an onsite search term"
        @input="emit('update:searchTerm', ($event.target as HTMLInputElement).value)"
      />
      <button :disabled="searching || refreshingAnalytics" class="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60" @click="emit('search')">
        {{ searching ? "Recording..." : "Record search" }}
      </button>
    </div>
    <div class="mt-6 space-y-3">
      <div v-for="post in posts" :key="post.id as number" class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-lg font-semibold">{{ post.title }}</p>
            <p class="mt-2 text-sm text-slate-600">{{ selectedPostId === post.id ? post.body : `${post.body.slice(0, 120)}${post.body.length > 120 ? '...' : ''}` }}</p>
          </div>
          <button :disabled="viewingPostId === post.id" class="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60" @click="emit('view', post.id as number, post.locationCode)">
            {{ viewingPostId === post.id ? "Recording..." : selectedPostId === post.id ? "Viewed" : "Open and record view" }}
          </button>
        </div>
      </div>
    </div>
  </SectionCard>
</template>
