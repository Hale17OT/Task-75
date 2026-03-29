import { reactive } from "vue";
import { useAuthStore } from "../stores/auth";
import type {
  DashboardTemplate,
  DashboardWidget,
  RecipientSummary,
  ReportInboxItem,
  ReportScheduleSummary
} from "../types";

type FeedbackSetter = (value: { error?: string | null; success?: string | null }) => void;

export const useDashboardsReports = (auth: ReturnType<typeof useAuthStore>, setFeedback: FeedbackSetter) => {
  const dashboardState = reactive({
    layout: [] as DashboardWidget[],
    templates: [] as DashboardTemplate[],
    templateName: ""
  });
  const reportsState = reactive({
    schedules: [] as ReportScheduleSummary[],
    recipients: [] as RecipientSummary[],
    inbox: [] as ReportInboxItem[],
    scheduleName: "Weekly Operations Snapshot",
    cronExpression: "0 6 * * 1",
    templateId: 0,
    scheduleFormat: "pdf" as "csv" | "excel" | "pdf",
    generateFormat: "pdf",
    subscriberUserIds: [] as number[],
    lastGeneratedReport: null as Record<string, unknown> | null,
    lastScheduledReport: null as Record<string, unknown> | null,
    loadingReports: false,
    savingLayout: false,
    savingTemplate: false,
    creatingSchedule: false,
    generatingReport: false,
    downloadingInboxId: null as number | null
  });
  const widgetPalette = [
    { widgetType: "viewsByStation", title: "Views by station" },
    { widgetType: "topPosts", title: "Top posts" },
    { widgetType: "searchTrends", title: "Search trends" }
  ];

  const resetDashboardsReportsState = () => {
    dashboardState.layout = [];
    dashboardState.templates = [];
    dashboardState.templateName = "";
    reportsState.schedules = [];
    reportsState.recipients = [];
    reportsState.inbox = [];
    reportsState.scheduleName = "Weekly Operations Snapshot";
    reportsState.cronExpression = "0 6 * * 1";
    reportsState.templateId = 0;
    reportsState.scheduleFormat = "pdf";
    reportsState.generateFormat = "pdf";
    reportsState.subscriberUserIds = [];
    reportsState.lastGeneratedReport = null;
    reportsState.lastScheduledReport = null;
    reportsState.loadingReports = false;
    reportsState.savingLayout = false;
    reportsState.savingTemplate = false;
    reportsState.creatingSchedule = false;
    reportsState.generatingReport = false;
    reportsState.downloadingInboxId = null;
  };

  const loadDashboards = async () => {
    const response = await auth.api().getDashboard();
    dashboardState.layout = response.layout;
    dashboardState.templates = response.templates;
    if (!reportsState.templateId && response.templates[0]) {
      reportsState.templateId = Number(response.templates[0].id);
    }
  };

  const loadReports = async () => {
    if (reportsState.loadingReports) return;
    reportsState.loadingReports = true;
    try {
    reportsState.inbox = (await auth.api().getInbox()).inbox;
    const isAdmin = auth.currentUser?.roles.includes("Administrator");

    if (isAdmin) {
      if (dashboardState.templates.length === 0) {
        await loadDashboards();
      }
      reportsState.schedules = (await auth.api().listSchedules()).schedules;
      reportsState.recipients = (await auth.api().listRecipients()).recipients;
    } else {
      reportsState.schedules = [];
      reportsState.recipients = [];
    }
    } finally {
      reportsState.loadingReports = false;
    }
  };

  const moveWidget = (fromIndex: number, toIndex: number) => {
    const layout = [...dashboardState.layout];
    const [item] = layout.splice(fromIndex, 1);
    layout.splice(toIndex, 0, item);
    dashboardState.layout = layout.map((widget, index) => ({
      ...widget,
      x: (index % 2) * 6,
      y: Math.floor(index / 2) * 4
    }));
  };

  const addWidget = (widgetType: string, title: string) => {
    const nextIndex = dashboardState.layout.length;
    dashboardState.layout = [
      ...dashboardState.layout,
      {
        id: `${widgetType}-${Date.now()}-${nextIndex}`,
        widgetType,
        title,
        x: (nextIndex % 2) * 6,
        y: Math.floor(nextIndex / 2) * 4,
        width: 6,
        height: 4
      }
    ];
  };

  const removeWidget = (widgetId: string) => {
    dashboardState.layout = dashboardState.layout
      .filter((widget) => widget.id !== widgetId)
      .map((widget, index) => ({
        ...widget,
        x: (index % 2) * 6,
        y: Math.floor(index / 2) * 4
      }));
  };

  const updateWidgetTitle = (widgetId: string, title: string) => {
    dashboardState.layout = dashboardState.layout.map((widget) =>
      widget.id === widgetId ? { ...widget, title } : widget
    );
  };

  const handleSaveDashboard = async () => {
    if (reportsState.savingLayout) return;
    reportsState.savingLayout = true;
    try {
      await auth.api().saveDashboard(dashboardState.layout);
      await loadDashboards();
      setFeedback({ success: "Dashboard layout saved as JSON for this administrator." });
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Dashboard save failed" });
    } finally {
      reportsState.savingLayout = false;
    }
  };

  const handleCreateTemplate = async () => {
    if (reportsState.savingTemplate) return;
    reportsState.savingTemplate = true;
    try {
      await auth.api().createTemplate(dashboardState.templateName, dashboardState.layout);
      dashboardState.templateName = "";
      await loadDashboards();
      setFeedback({ success: "Reusable report template saved." });
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Template save failed" });
    } finally {
      reportsState.savingTemplate = false;
    }
  };

  const handleCreateSchedule = async () => {
    if (reportsState.creatingSchedule) return;
    reportsState.creatingSchedule = true;
    try {
      reportsState.lastScheduledReport = (await auth.api().createSchedule({
        templateId: reportsState.templateId,
        name: reportsState.scheduleName,
        cronExpression: reportsState.cronExpression,
        format: reportsState.scheduleFormat,
        subscriberUserIds: reportsState.subscriberUserIds
      })).schedule as Record<string, unknown>;
      await loadReports();
      setFeedback({ success: "Scheduled report created with explicit subscriptions." });
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Schedule creation failed" });
    } finally {
      reportsState.creatingSchedule = false;
    }
  };

  const handleGenerateReport = async () => {
    if (reportsState.generatingReport) return;
    reportsState.generatingReport = true;
    try {
      reportsState.lastGeneratedReport = (await auth.api().generateReport({
        templateId: reportsState.templateId,
        format: reportsState.generateFormat
      })).report as Record<string, unknown>;
      await loadReports();
      setFeedback({ success: "Report generated and delivered to the inbox." });
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Report generation failed" });
    } finally {
      reportsState.generatingReport = false;
    }
  };

  const downloadInboxItem = async (inboxItemId: number) => {
    if (reportsState.downloadingInboxId === inboxItemId) return;
    reportsState.downloadingInboxId = inboxItemId;
    try {
      const { blob, fileName } = await auth.api().downloadInboxItem(inboxItemId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      await loadReports();
      setFeedback({ success: "Report download started from the in-app inbox." });
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Report download failed" });
    } finally {
      reportsState.downloadingInboxId = null;
    }
  };

  return {
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
  };
};
