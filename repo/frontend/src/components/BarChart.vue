<script setup lang="ts">
import { Chart, type ChartConfiguration } from "chart.js/auto";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  labels: string[];
  values: number[];
  color: string;
  title?: string;
}>();

const emit = defineEmits<{
  select: [payload: { index: number; label: string; value: number }];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

const renderChart = () => {
  if (!canvasRef.value) {
    return;
  }

  chart?.destroy();
  const config: ChartConfiguration = {
    type: "bar",
    data: {
      labels: props.labels,
      datasets: [
        {
          data: props.values,
          backgroundColor: props.color,
          borderRadius: 10
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_event, elements) => {
        const first = elements[0];
        if (!first) {
          return;
        }

        emit("select", {
          index: first.index,
          label: props.labels[first.index] ?? "",
          value: props.values[first.index] ?? 0
        });
      },
      plugins: {
        legend: {
          display: false
        },
        title: {
          display: Boolean(props.title),
          text: props.title
        }
      }
    }
  };

  chart = new Chart(canvasRef.value, config);
};

onMounted(renderChart);
watch(() => [props.labels, props.values], renderChart, { deep: true });
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <div class="h-64 w-full">
    <canvas ref="canvasRef"></canvas>
  </div>
</template>
