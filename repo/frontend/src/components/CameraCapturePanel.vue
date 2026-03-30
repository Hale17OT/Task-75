<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

const props = defineProps<{
  label: string;
  modelValue: string;
  sourceType: "camera" | "import";
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:sourceType": [value: "camera" | "import"];
}>();

const videoRef = ref<HTMLVideoElement | null>(null);
const stream = ref<MediaStream | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const maxImportBytes = 5 * 1024 * 1024;
const minImportWidth = 640;
const minImportHeight = 480;

const hasPreview = computed(() => Boolean(props.modelValue));

const stopCamera = () => {
  stream.value?.getTracks().forEach((track) => track.stop());
  stream.value = null;
};

const startCamera = async () => {
  error.value = null;
  busy.value = true;

  try {
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      },
      audio: false
    });

    if (videoRef.value) {
      videoRef.value.srcObject = stream.value;
      await videoRef.value.play();
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Camera access failed";
  } finally {
    busy.value = false;
  }
};

const captureFrame = () => {
  if (!videoRef.value) {
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = videoRef.value.videoWidth || 1280;
  canvas.height = videoRef.value.videoHeight || 720;
  const context = canvas.getContext("2d");
  if (!context) {
    error.value = "Camera frame capture is unavailable";
    return;
  }

  context.drawImage(videoRef.value, 0, 0, canvas.width, canvas.height);
  emit("update:modelValue", canvas.toDataURL("image/png"));
  emit("update:sourceType", "camera");
  stopCamera();
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const getImageDimensions = (dataUrl: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height
      });
    };
    image.onerror = () => reject(new Error("Could not read image dimensions"));
    image.src = dataUrl;
  });

const onFilePicked = async (event: Event) => {
  error.value = null;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  const supportedTypes = ["image/png", "image/jpeg"];
  if (!supportedTypes.includes(file.type)) {
    error.value = "Only JPG and PNG images are supported.";
    input.value = "";
    return;
  }

  if (file.size > maxImportBytes) {
    error.value = "Image must be 5 MB or smaller.";
    input.value = "";
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const { width, height } = await getImageDimensions(dataUrl);
    if (width < minImportWidth || height < minImportHeight) {
      error.value = "Image must be at least 640x480 pixels.";
      input.value = "";
      return;
    }

    emit("update:modelValue", dataUrl);
    emit("update:sourceType", "import");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Image import failed";
  }
};

onBeforeUnmount(stopCamera);
</script>

<template>
  <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
    <div class="flex items-start justify-between gap-4">
      <div>
        <p class="text-sm font-semibold text-ink">{{ label }}</p>
        <p class="mt-1 text-xs leading-5 text-slate-500">
          Capture from the front-desk camera or import a JPG/PNG file up to 5 MB and at least 640x480.
        </p>
        <p class="mt-1 text-xs text-slate-500">Audit source: {{ sourceType }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          :disabled="busy"
          @click="startCamera"
        >
          {{ busy ? "Opening..." : "Use camera" }}
        </button>
        <label class="cursor-pointer rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">
          Import image
          <input class="hidden" type="file" accept="image/png,image/jpeg" @change="onFilePicked" />
        </label>
      </div>
    </div>

    <p v-if="error" class="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
      {{ error }}
    </p>

    <div v-if="stream" class="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-slate-950">
      <video ref="videoRef" autoplay muted playsinline class="aspect-video w-full object-cover"></video>
      <div class="flex justify-end border-t border-slate-800 bg-slate-900 px-4 py-3">
        <button class="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white" type="button" @click="captureFrame">
          Capture frame
        </button>
      </div>
    </div>

    <div v-else-if="hasPreview" class="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white">
      <img :src="modelValue" :alt="label" class="max-h-72 w-full object-contain" />
    </div>
  </div>
</template>
