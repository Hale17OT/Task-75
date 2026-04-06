<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import AdminConsoleView from "./components/AdminConsoleView.vue";
import AnalyticsView from "./components/AnalyticsView.vue";
import AuthShell from "./components/AuthShell.vue";
import ContentView from "./components/ContentView.vue";
import DashboardBuilderView from "./components/DashboardBuilderView.vue";
import FaceOpsView from "./components/FaceOpsView.vue";
import InboxView from "./components/InboxView.vue";
import MembersView from "./components/MembersView.vue";
import OverviewView from "./components/OverviewView.vue";
import ReportsView from "./components/ReportsView.vue";
import WarmLockModal from "./components/WarmLockModal.vue";
import { useAdminConsole } from "./composables/useAdminConsole";
import { useContentAnalytics } from "./composables/useContentAnalytics";
import { useDashboardsReports } from "./composables/useDashboardsReports";
import { useFaceOps } from "./composables/useFaceOps";
import { useMembers } from "./composables/useMembers";
import { useAuthStore } from "./stores/auth";

const auth = useAuthStore();
const loginForm = reactive({
  username: "",
  password: "",
  pin: "",
  newPin: "",
  bootstrapFullName: ""
});
const feedback = reactive<Record<string, { error: string | null; success: string | null }>>({
  members: { error: null, success: null },
  faces: { error: null, success: null },
  content: { error: null, success: null },
  analytics: { error: null, success: null },
  dashboards: { error: null, success: null },
  reports: { error: null, success: null },
  admin: { error: null, success: null }
});
const warmLockTimer = ref<number | null>(null);
const refreshQueued = ref(false);

const setFeedback = (section: keyof typeof feedback, value: { error?: string | null; success?: string | null }) => {
  feedback[section].error = value.error ?? null;
  feedback[section].success = value.success ?? null;
};

const {
  membersState,
  memberSelf,
  loadMembers,
  loadSelf,
  handleCreateMember,
  handleAssignCoach,
  handleMemberConsent,
  handleOwnConsent,
  resetMembersState
} = useMembers(auth, (value) => setFeedback("members", value));

const { faceState, loadFaceHistory, handleEnrollFace, handleDeactivateFace, resetFaceState } = useFaceOps(auth, (value) =>
  setFeedback("faces", value)
);

const {
  contentState,
  analyticsDrilldown,
  chartData,
  loadContent,
  loadAnalytics,
  handleCreatePost,
  handleViewPost,
  handleSearchContent,
  handleRefreshAnalytics,
  selectStationDrilldown,
  selectPostDrilldown,
  selectSearchDrilldown,
  resetContentState
} = useContentAnalytics(auth, (value) => {
  if (value.success?.includes("Analytics") || value.error?.includes("date")) {
    setFeedback("analytics", value);
    if (value.success) {
      setFeedback("content", {});
    }
    return;
  }

  setFeedback("content", value);
});

const {
  dashboardState,
  reportsState,
  widgetPalette,
  loadDashboards,
  loadReports,
  moveWidget,
  addWidget,
  removeWidget,
  updateWidgetTitle,
  handleSaveDashboard,
  handleCreateTemplate,
  handleCreateSchedule,
  handleGenerateReport,
  downloadInboxItem,
  resetDashboardsReportsState
} = useDashboardsReports(auth, (value) => {
  const target =
    value.success?.includes("report") ||
    value.success?.includes("Report") ||
    value.error?.includes("Report") ||
    value.error?.includes("Schedule")
      ? "reports"
      : "dashboards";
  setFeedback(target, value);
});

const { adminState, loadAdmin, handleCreateBackup, handleDryRunRestore, resetAdminState } = useAdminConsole(auth, (value) =>
  setFeedback("admin", value)
);

const isCoachOrAdmin = computed(
  () => auth.currentUser?.roles.includes("Coach") || auth.currentUser?.roles.includes("Administrator")
);
const isMember = computed(() => auth.currentUser?.hasMemberProfile === true);
const isAdmin = computed(() => auth.currentUser?.roles.includes("Administrator"));
const canUseInbox = computed(() => Boolean(auth.currentUser));
const faceMembers = computed(() =>
  isCoachOrAdmin.value
    ? membersState.members
    : memberSelf.value
      ? [memberSelf.value]
      : []
);
const navItems = computed(() =>
  [
    { id: "overview", label: "Overview", visible: true },
    { id: "members", label: "Members", visible: isCoachOrAdmin.value },
    { id: "faces", label: "Face Ops", visible: isCoachOrAdmin.value || isMember.value },
    { id: "content", label: "Content", visible: isCoachOrAdmin.value },
    { id: "analytics", label: "Analytics", visible: isCoachOrAdmin.value },
    { id: "dashboards", label: "Dashboards", visible: isAdmin.value },
    { id: "reports", label: "Reports", visible: isAdmin.value },
    { id: "inbox", label: "Inbox", visible: canUseInbox.value },
    { id: "admin", label: "Admin Console", visible: isAdmin.value }
  ].filter((item) => item.visible)
);

const clearFeedback = () => {
  for (const section of Object.keys(feedback) as Array<keyof typeof feedback>) {
    feedback[section].error = null;
    feedback[section].success = null;
  }
};

const resetFeatureState = () => {
  resetMembersState();
  resetFaceState();
  resetContentState();
  resetDashboardsReportsState();
  resetAdminState();
  clearFeedback();
};

const ensureActiveViewAuthorization = () => {
  if (!auth.canAccessView(auth.activeView as never)) {
    auth.setActiveView("overview");
  }
};

const selectView = (viewId: string) => {
  auth.setActiveView(viewId as never);
};

const handleLogout = async () => {
  await auth.logout();
  resetFeatureState();
};

const refreshView = async () => {
  if (!auth.currentUser || !auth.sessionSecret) return;
  ensureActiveViewAuthorization();
  if (!auth.canAccessView(auth.activeView as never)) return;

  try {
    if (auth.activeView === "overview" && auth.currentUser.hasMemberProfile) {
      await loadSelf();
    }
    if (auth.activeView === "members") {
      await loadMembers();
    }
    if (auth.activeView === "faces") {
      if (isCoachOrAdmin.value) {
        await loadMembers();
        if (!faceState.selectedMemberId && membersState.members[0]) {
          faceState.selectedMemberId = membersState.members[0].id;
        }
      } else {
        await loadSelf();
        if (memberSelf.value?.id) {
          faceState.selectedMemberId = memberSelf.value.id;
        }
      }
      await loadFaceHistory();
    }
    if (auth.activeView === "content") {
      await loadContent();
    }
    if (auth.activeView === "analytics") {
      await loadAnalytics();
    }
    if (auth.activeView === "dashboards") {
      await loadDashboards();
    }
    if (auth.activeView === "reports" || auth.activeView === "inbox") {
      await loadReports();
    }
    if (auth.activeView === "admin") {
      await loadAdmin();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load the requested view";
    const key = auth.activeView === "inbox" ? "reports" : (auth.activeView as keyof typeof feedback);
    if (feedback[key]) {
      setFeedback(key, { error: message });
    }
  }
};

const queueRefreshView = () => {
  if (refreshQueued.value) return;
  refreshQueued.value = true;
  window.queueMicrotask(() => {
    refreshQueued.value = false;
    void refreshView();
  });
};

const resetWarmLockTimer = () => {
  if (warmLockTimer.value) window.clearTimeout(warmLockTimer.value);
  if (auth.currentUser && auth.hasPin && auth.sessionSecret) {
    warmLockTimer.value = window.setTimeout(() => void auth.triggerWarmLock(), auth.warmLockMinutes * 60 * 1000);
  }
};

const handleBootstrapAdministrator = async () => {
  await auth.bootstrapAdministrator(loginForm.username, loginForm.bootstrapFullName, loginForm.password);
};

onMounted(async () => {
  await auth.bootstrap();
  window.addEventListener("mousemove", resetWarmLockTimer);
  window.addEventListener("keydown", resetWarmLockTimer);
});

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", resetWarmLockTimer);
  window.removeEventListener("keydown", resetWarmLockTimer);
});

watch(() => auth.sessionSecret, () => {
  queueRefreshView();
});
watch(() => auth.activeView, () => {
  queueRefreshView();
});
watch(
  () => auth.currentUser?.id,
  (current, previous) => {
    if (current !== previous) {
      resetFeatureState();
    }
    ensureActiveViewAuthorization();
    if (auth.sessionSecret) {
      queueRefreshView();
    }
  }
);
watch(
  () => auth.warmLocked,
  (locked) => {
    if (locked) {
      resetFeatureState();
    }
  }
);
watch(
  () => auth.sessionSecret,
  (secret) => {
    if (!secret) {
      resetFeatureState();
    }
  }
);
watch(() => faceState.selectedMemberId, async () => {
  if (auth.activeView === "faces" && auth.sessionSecret) {
    await loadFaceHistory();
  }
});
</script>

<template>
  <div class="min-h-screen bg-surface text-ink">
    <WarmLockModal v-if="auth.warmLocked" @unlock="auth.reenterWithPin" />

    <AuthShell
      v-if="!auth.currentUser || !auth.sessionSecret"
      :current-user="auth.currentUser"
      :session-secret="auth.sessionSecret"
      :has-pin="auth.hasPin"
      :bootstrap-required="auth.bootstrapRequired"
      :error="auth.error"
      :loading="auth.loading"
      :station-token="auth.stationToken"
      :form="loginForm"
      @update:station-token="auth.setStationToken($event)"
      @login="auth.login(loginForm.username, loginForm.password)"
      @reenter="auth.reenterWithPin(loginForm.pin)"
      @bootstrap="handleBootstrapAdministrator"
    />

    <template v-else>
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-5">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.16em] text-accent">SentinelFit Operations</p>
            <h1 class="mt-1 text-2xl font-semibold">{{ auth.currentUser.fullName }}</h1>
          </div>
          <div class="flex items-center gap-3">
            <input :value="auth.stationToken" class="rounded-2xl border border-slate-300 px-4 py-3 text-sm" @input="auth.setStationToken(($event.target as HTMLInputElement).value)" />
            <button class="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold" @click="handleLogout">Logout</button>
          </div>
        </div>
      </header>

      <div class="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[220px_1fr]">
        <aside class="rounded-[28px] border border-slate-200 bg-white p-4 shadow-soft">
          <nav class="space-y-2">
            <button
              v-for="item in navItems"
              :key="item.id"
              class="flex w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold transition"
              :class="auth.activeView === item.id ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'"
              @click="selectView(item.id)"
            >
              {{ item.label }}
            </button>
          </nav>
        </aside>

        <section class="space-y-6">
          <OverviewView
            v-if="auth.activeView === 'overview' && auth.canAccessView('overview')"
            :current-user="auth.currentUser"
            :station-token="auth.stationToken"
            :has-pin="auth.hasPin"
            :new-pin="loginForm.newPin"
            :member-self="memberSelf"
            @update:new-pin="loginForm.newPin = $event"
            @save-pin="auth.setupPin(loginForm.newPin)"
            @own-consent="handleOwnConsent"
          />

          <MembersView
            v-else-if="auth.activeView === 'members' && auth.canAccessView('members')"
            :members="membersState.members"
            :coaches="membersState.coaches"
            :form="membersState.form"
            :creating="membersState.creating"
            :assigning-member-id="membersState.assigningMemberId"
            :consenting-member-id="membersState.consentingMemberId"
            :section-error="feedback.members.error"
            :section-success="feedback.members.success"
            @create="handleCreateMember"
            @assign-coach="handleAssignCoach"
            @consent="handleMemberConsent"
          />

          <FaceOpsView
            v-else-if="auth.activeView === 'faces' && auth.canAccessView('faces')"
            :members="faceMembers"
            :selected-member-id="faceState.selectedMemberId"
            :center-image-base64="faceState.centerImageBase64"
            :turn-image-base64="faceState.turnImageBase64"
            :center-source-type="faceState.centerSourceType"
            :turn-source-type="faceState.turnSourceType"
            :center-annotation="faceState.centerAnnotation"
            :turn-annotation="faceState.turnAnnotation"
            :dedup-preview="faceState.dedupPreview"
            :dedup-checking="faceState.dedupChecking"
            :challenge-issued-at="faceState.challengeIssuedAt"
            :challenge-expires-at="faceState.challengeExpiresAt"
            :result="faceState.result"
            :history="faceState.history"
            :audit-trail="faceState.auditTrail"
            :section-error="feedback.faces.error"
            :section-success="feedback.faces.success"
            @update:selected-member-id="faceState.selectedMemberId = $event"
            @update:center-image-base64="faceState.centerImageBase64 = $event"
            @update:turn-image-base64="faceState.turnImageBase64 = $event"
            @update:center-source-type="faceState.centerSourceType = $event"
            @update:turn-source-type="faceState.turnSourceType = $event"
            @update:center-annotation="faceState.centerAnnotation = $event"
            @update:turn-annotation="faceState.turnAnnotation = $event"
            @enroll="handleEnrollFace"
            @refresh-history="loadFaceHistory"
            @deactivate="handleDeactivateFace"
          />

          <ContentView
            v-else-if="auth.activeView === 'content' && auth.canAccessView('content')"
            :post-form="contentState.postForm"
            :posts="contentState.posts"
            :search-term="contentState.searchTerm"
            :selected-post-id="contentState.selectedPostId"
            :publishing="contentState.publishing"
            :searching="contentState.searching"
            :refreshing-analytics="contentState.refreshingAnalytics"
            :viewing-post-id="contentState.viewingPostId"
            :section-error="feedback.content.error"
            :section-success="feedback.content.success"
            @publish="handleCreatePost"
            @update:search-term="contentState.searchTerm = $event"
            @search="handleSearchContent"
            @view="handleViewPost"
          />

          <AnalyticsView
            v-else-if="auth.activeView === 'analytics' && auth.canAccessView('analytics')"
            :filters="contentState.filters"
            :analytics="contentState.analytics"
            :chart-data="chartData"
            :drilldown-title="analyticsDrilldown.title"
            :drilldown-rows="analyticsDrilldown.rows"
            :section-error="feedback.analytics.error"
            :section-success="feedback.analytics.success"
            @refresh="handleRefreshAnalytics"
            @select-station="selectStationDrilldown"
            @select-post="selectPostDrilldown"
            @select-search="selectSearchDrilldown"
          />

          <DashboardBuilderView
            v-else-if="auth.activeView === 'dashboards' && auth.canAccessView('dashboards')"
            :widget-palette="widgetPalette"
            :layout="dashboardState.layout"
            :template-name="dashboardState.templateName"
            :saving-layout="reportsState.savingLayout"
            :saving-template="reportsState.savingTemplate"
            :section-error="feedback.dashboards.error"
            :section-success="feedback.dashboards.success"
            @add-widget="addWidget"
            @move-widget="moveWidget"
            @remove-widget="removeWidget"
            @update-widget-title="updateWidgetTitle"
            @update:template-name="dashboardState.templateName = $event"
            @save-layout="handleSaveDashboard"
            @save-template="handleCreateTemplate"
          />

          <ReportsView
            v-else-if="auth.activeView === 'reports' && auth.canAccessView('reports')"
            :templates="dashboardState.templates"
            :recipients="reportsState.recipients"
            :schedules="reportsState.schedules"
            :inbox="reportsState.inbox"
            :schedule-form="reportsState"
            :section-error="feedback.reports.error"
            :section-success="feedback.reports.success"
            :creating-schedule="reportsState.creatingSchedule"
            :generating-report="reportsState.generatingReport"
            :downloading-inbox-id="reportsState.downloadingInboxId"
            :last-generated-report="reportsState.lastGeneratedReport"
            :last-scheduled-report="reportsState.lastScheduledReport"
            @create-schedule="handleCreateSchedule"
            @generate="handleGenerateReport"
            @download="downloadInboxItem"
          />

          <InboxView
            v-else-if="auth.activeView === 'inbox' && auth.canAccessView('inbox')"
            :inbox="reportsState.inbox"
            :downloading-inbox-id="reportsState.downloadingInboxId"
            @download="downloadInboxItem"
          />

          <AdminConsoleView
            v-else-if="auth.activeView === 'admin' && auth.canAccessView('admin')"
            :console-data="adminState.console as never"
            :backup-result="adminState.backupResult"
            :recovery-result="adminState.recoveryResult"
            :dry-run-backup-id="adminState.dryRunBackupId"
            :loading-backup="adminState.loadingBackup"
            :loading-recovery="adminState.loadingRecovery"
            :section-error="feedback.admin.error"
            @update:dry-run-backup-id="adminState.dryRunBackupId = $event"
            @backup="handleCreateBackup"
            @dry-run="handleDryRunRestore"
          />
        </section>
      </div>
    </template>
  </div>
</template>
