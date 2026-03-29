<script setup lang="ts">
import * as tf from "@tensorflow/tfjs";
import { computed, ref, watch } from "vue";

interface AnnotatedPoint {
  x: number;
  y: number;
}

const props = defineProps<{
  label: string;
  modelValue: string;
}>();

const emit = defineEmits<{
  update: [
    payload: {
      landmarks: { leftEye: AnnotatedPoint; rightEye: AnnotatedPoint; nose: AnnotatedPoint } | null;
      faceBox: { x: number; y: number; width: number; height: number } | null;
      blurScore: number | null;
      faceInFrame: boolean;
    }
  ];
}>();

const previewUrl = ref("");
const clickPoints = ref<AnnotatedPoint[]>([]);
const blurScore = ref<number | null>(null);

const pointLabels = ["Left eye", "Right eye", "Nose"];

const faceBox = computed(() => {
  if (clickPoints.value.length < 3) {
    return null;
  }

  const xs = clickPoints.value.map((point) => point.x);
  const ys = clickPoints.value.map((point) => point.y);
  const padding = 0.15;
  const minX = Math.max(0, Math.min(...xs) - padding);
  const maxX = Math.min(1, Math.max(...xs) + padding);
  const minY = Math.max(0, Math.min(...ys) - padding);
  const maxY = Math.min(1, Math.max(...ys) + padding);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
});

const landmarks = computed(() => {
  if (clickPoints.value.length < 3) {
    return null;
  }

  const [leftEye, rightEye, nose] = clickPoints.value as [
    AnnotatedPoint,
    AnnotatedPoint,
    AnnotatedPoint
  ];

  return {
    leftEye,
    rightEye,
    nose
  };
});

const analyze = async (dataUrl: string) => {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();

  const tensor = await tf.browser.fromPixelsAsync(image);
  const grayscale = tensor.mean(2);
  const height = grayscale.shape[0] ?? 1;
  const width = grayscale.shape[1] ?? 1;
  const shiftedX = grayscale.slice([0, 1], [-1, width - 1]);
  const shiftedY = grayscale.slice([1, 0], [height - 1, -1]);
  const baseX = grayscale.slice([0, 0], [-1, width - 1]);
  const baseY = grayscale.slice([0, 0], [height - 1, -1]);
  const edge = shiftedX.sub(baseX).abs().add(shiftedY.sub(baseY).abs());
  const moments = tf.moments(edge);
  const variance = moments.variance.dataSync()[0] ?? 0;
  blurScore.value = Number(Math.sqrt(variance).toFixed(2));
  tf.dispose([tensor, grayscale, shiftedX, shiftedY, baseX, baseY, edge, moments.mean, moments.variance]);
};

watch(
  () => props.modelValue,
  async (value) => {
    previewUrl.value = value;
    clickPoints.value = [];
    blurScore.value = null;
    if (value) {
      await analyze(value);
    }
  },
  { immediate: true }
);

watch(
  [landmarks, faceBox, blurScore],
  () => {
    emit("update", {
      landmarks: landmarks.value,
      faceBox: faceBox.value,
      blurScore: blurScore.value,
      faceInFrame: Boolean(faceBox.value)
    });
  },
  { deep: true }
);

const handleImageClick = (event: MouseEvent) => {
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;

  if (clickPoints.value.length < 3) {
    clickPoints.value = [...clickPoints.value, { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) }];
  }
};

const resetPoints = () => {
  clickPoints.value = [];
};
</script>

<template>
  <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
    <div class="flex items-center justify-between gap-4">
      <div>
        <p class="text-sm font-semibold text-ink">{{ label }}</p>
        <p class="text-xs text-slate-500">
          Click the left eye, right eye, and nose in that order to complete face-in-frame guidance.
        </p>
      </div>
      <button class="text-sm font-semibold text-accent" type="button" @click="resetPoints">
        Reset points
      </button>
    </div>

    <div
      v-if="previewUrl"
      class="relative mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white"
      @click="handleImageClick"
    >
      <img :src="previewUrl" alt="" class="max-h-80 w-full object-contain" />
      <div
        v-for="(point, index) in clickPoints"
        :key="`${point.x}-${point.y}-${index}`"
        class="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent"
        :style="{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }"
      ></div>
    </div>

    <div class="mt-4 grid gap-3 md:grid-cols-2">
      <div class="rounded-2xl border border-slate-200 bg-white p-3">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Blur score</p>
        <p class="mt-2 text-lg font-semibold text-ink">{{ blurScore ?? "Waiting" }}</p>
        <p class="mt-1 text-xs font-semibold" :class="(blurScore ?? 0) >= 12 ? 'text-emerald-600' : 'text-amber-600'">
          {{ (blurScore ?? 0) >= 12 ? "Quality gate passed" : "Needs a sharper image" }}
        </p>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-white p-3">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Landmark progress</p>
        <p class="mt-2 text-sm font-semibold text-ink">
          {{ clickPoints.length }}/3:
          {{ pointLabels[clickPoints.length] ?? "complete" }}
        </p>
        <p class="mt-1 text-xs font-semibold" :class="clickPoints.length === 3 ? 'text-emerald-600' : 'text-amber-600'">
          {{ clickPoints.length === 3 ? "Face-in-frame guidance ready" : "Mark the face to continue" }}
        </p>
      </div>
    </div>
  </div>
</template>
