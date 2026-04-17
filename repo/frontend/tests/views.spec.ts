import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AdminConsoleView from "../src/components/AdminConsoleView.vue";
import AnalyticsView from "../src/components/AnalyticsView.vue";
import ContentView from "../src/components/ContentView.vue";
import DashboardBuilderView from "../src/components/DashboardBuilderView.vue";
import InboxView from "../src/components/InboxView.vue";
import MembersView from "../src/components/MembersView.vue";
import MetricCard from "../src/components/MetricCard.vue";
import SectionCard from "../src/components/SectionCard.vue";

vi.mock("../src/components/BarChart.vue", () => ({
  default: {
    name: "BarChart",
    props: ["labels", "values", "color", "title"],
    emits: ["select"],
    template: '<div data-test="bar-chart" :data-title="title"></div>'
  }
}));

describe("SectionCard", () => {
  it("renders title and eyebrow and exposes the default slot", () => {
    const wrapper = mount(SectionCard, {
      props: { title: "Members", eyebrow: "Enrollment" },
      slots: { default: '<p class="child">child content</p>' }
    });

    expect(wrapper.get("h2").text()).toBe("Members");
    expect(wrapper.text()).toContain("Enrollment");
    expect(wrapper.find(".child").text()).toBe("child content");
  });

  it("omits the eyebrow element when not provided", () => {
    const wrapper = mount(SectionCard, {
      props: { title: "Plain" },
      slots: { default: "<span />" }
    });

    expect(wrapper.find("h2").text()).toBe("Plain");
    expect(wrapper.find("p.text-xs").exists()).toBe(false);
  });
});

describe("MetricCard", () => {
  it("renders the label and string value", () => {
    const wrapper = mount(MetricCard, { props: { label: "Uptime", value: "123 s" } });
    expect(wrapper.text()).toContain("Uptime");
    expect(wrapper.text()).toContain("123 s");
  });

  it("applies an accent color via inline style when provided", () => {
    const wrapper = mount(MetricCard, {
      props: { label: "Errors", value: 5, accent: "rgb(255, 0, 0)" }
    });
    const valueEl = wrapper.get("p.text-3xl");
    expect(valueEl.attributes("style") ?? "").toContain("rgb(255, 0, 0)");
  });
});

describe("InboxView", () => {
  const baseItem = {
    id: 11,
    reportExportId: 1,
    title: "Weekly Snapshot (PDF)",
    isRead: false,
    createdAt: "2026-04-10T12:00:00.000Z",
    format: "pdf",
    status: "completed",
    fileName: "weekly-snapshot.pdf"
  };

  it("renders each inbox item with filename and status", () => {
    const wrapper = mount(InboxView, { props: { inbox: [baseItem] } });
    expect(wrapper.text()).toContain("Weekly Snapshot (PDF)");
    expect(wrapper.text()).toContain("weekly-snapshot.pdf");
    expect(wrapper.text()).toContain("completed");
    expect(wrapper.text()).toContain("Shared folder synced");
  });

  it("surfaces a failure hint when the item is not completed", () => {
    const wrapper = mount(InboxView, {
      props: { inbox: [{ ...baseItem, status: "failed" }] }
    });
    expect(wrapper.text()).toContain("Shared folder issue");
  });

  it("emits download events with the item id", async () => {
    const wrapper = mount(InboxView, { props: { inbox: [baseItem] } });
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("download")?.[0]).toEqual([11]);
  });

  it("shows the empty state when no items exist", () => {
    const wrapper = mount(InboxView, { props: { inbox: [] } });
    expect(wrapper.text()).toContain("Scheduled and ad-hoc report deliveries");
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("disables the row button while its id matches downloadingInboxId", () => {
    const wrapper = mount(InboxView, {
      props: { inbox: [baseItem], downloadingInboxId: 11 }
    });
    const button = wrapper.get("button");
    expect(button.text()).toContain("Downloading...");
    expect(button.attributes("disabled")).toBeDefined();
  });
});

describe("MembersView", () => {
  const baseForm = {
    username: "",
    fullName: "",
    password: "",
    phone: "",
    locationCode: "HQ",
    notes: "",
    coachUserId: null as number | null
  };
  const coach = { id: 2, username: "coach", fullName: "Default Coach" };
  const member = {
    id: 7,
    username: "member-one",
    fullName: "Member One",
    phoneMasked: "***1234",
    phoneLast4: "1234",
    locationCode: "HQ",
    notes: null,
    active: true,
    coachUserId: null as number | null,
    faceConsentStatus: "pending"
  };

  it("emits create when the Create member button is clicked", async () => {
    const wrapper = mount(MembersView, {
      props: {
        members: [],
        coaches: [coach],
        form: { ...baseForm },
        sectionError: null,
        sectionSuccess: null
      }
    });
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("create")).toHaveLength(1);
  });

  it("disables the Create member button and updates its label while creating", () => {
    const wrapper = mount(MembersView, {
      props: {
        members: [],
        coaches: [coach],
        form: { ...baseForm },
        creating: true,
        sectionError: null,
        sectionSuccess: null
      }
    });
    const createButton = wrapper.findAll("button").find((b) => b.text().includes("Creating member"));
    expect(createButton).toBeTruthy();
    expect(createButton?.attributes("disabled")).toBeDefined();
  });

  it("emits consent with granted status for the clicked member", async () => {
    const wrapper = mount(MembersView, {
      props: {
        members: [member],
        coaches: [coach],
        form: { ...baseForm },
        sectionError: null,
        sectionSuccess: null
      }
    });
    const grantButton = wrapper
      .findAll("button")
      .find((b) => b.text() === "Grant face consent");
    expect(grantButton).toBeTruthy();
    await grantButton!.trigger("click");
    expect(wrapper.emitted("consent")?.[0]).toEqual([7, "granted"]);
  });

  it("emits assignCoach when a coach is selected for an existing member", async () => {
    const wrapper = mount(MembersView, {
      props: {
        members: [member],
        coaches: [coach],
        form: { ...baseForm },
        sectionError: null,
        sectionSuccess: null
      }
    });
    const selects = wrapper.findAll("select");
    const assignSelect = selects[selects.length - 1];
    await assignSelect.setValue("2");
    expect(wrapper.emitted("assignCoach")?.[0]).toEqual([7, 2]);
  });

  it("renders section error and success banners when present", () => {
    const wrapper = mount(MembersView, {
      props: {
        members: [],
        coaches: [],
        form: { ...baseForm },
        sectionError: "Something blew up",
        sectionSuccess: "All good"
      }
    });
    expect(wrapper.text()).toContain("Something blew up");
    expect(wrapper.text()).toContain("All good");
  });
});

describe("ContentView", () => {
  const baseForm = { kind: "tip", title: "", body: "", locationCode: "HQ" };
  const post = {
    id: 9,
    kind: "tip",
    title: "Mobility",
    body: "Hold your posture through the set.",
    locationCode: "HQ",
    authorName: "Coach",
    createdAt: "2026-04-10T12:00:00.000Z"
  };

  it("emits publish when the publish button is clicked", async () => {
    const wrapper = mount(ContentView, {
      props: {
        postForm: { ...baseForm },
        posts: [],
        searchTerm: "",
        selectedPostId: null,
        sectionError: null,
        sectionSuccess: null
      }
    });
    const publishButton = wrapper.findAll("button").find((b) => b.text().includes("Publish post"));
    await publishButton!.trigger("click");
    expect(wrapper.emitted("publish")).toHaveLength(1);
  });

  it("emits update:searchTerm when the search field changes", async () => {
    const wrapper = mount(ContentView, {
      props: {
        postForm: { ...baseForm },
        posts: [],
        searchTerm: "",
        selectedPostId: null,
        sectionError: null,
        sectionSuccess: null
      }
    });
    const searchInput = wrapper
      .findAll("input")
      .find((i) => i.attributes("placeholder")?.includes("search"));
    await searchInput!.setValue("mobility");
    const emitted = wrapper.emitted("update:searchTerm")?.[0];
    expect(emitted).toEqual(["mobility"]);
  });

  it("emits view with postId and locationCode when opening a post", async () => {
    const wrapper = mount(ContentView, {
      props: {
        postForm: { ...baseForm },
        posts: [post],
        searchTerm: "",
        selectedPostId: null,
        sectionError: null,
        sectionSuccess: null
      }
    });
    const openButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("Open and record view"));
    await openButton!.trigger("click");
    expect(wrapper.emitted("view")?.[0]).toEqual([9, "HQ"]);
  });

  it("renders the full body when the post is the selected post", () => {
    const longPost = {
      ...post,
      body: "x".repeat(200)
    };
    const wrapper = mount(ContentView, {
      props: {
        postForm: { ...baseForm },
        posts: [longPost],
        searchTerm: "",
        selectedPostId: 9,
        sectionError: null,
        sectionSuccess: null
      }
    });
    expect(wrapper.text()).toContain("x".repeat(200));
  });

  it("truncates the body preview when the post is not selected", () => {
    const longPost = {
      ...post,
      title: "Truncate Probe",
      body: "z".repeat(200)
    };
    const wrapper = mount(ContentView, {
      props: {
        postForm: { ...baseForm },
        posts: [longPost],
        searchTerm: "",
        selectedPostId: null,
        sectionError: null,
        sectionSuccess: null
      }
    });
    expect(wrapper.text()).toContain(`${"z".repeat(120)}...`);
    expect(wrapper.text()).not.toContain("z".repeat(121));
  });
});

describe("AnalyticsView", () => {
  const filters = {
    startDateText: "",
    endDateText: "",
    locationCode: "HQ",
    includeHistorical: false
  };
  const chartData = {
    stations: [{ stationToken: "Front-Desk-01", views: 12 }],
    posts: [{ title: "Mobility", views: 9 }],
    searches: [{ term: "flex", uses: 3 }]
  };

  it("emits refresh when the refresh button is clicked", async () => {
    const wrapper = mount(AnalyticsView, {
      props: {
        filters,
        analytics: null,
        drilldownTitle: "",
        drilldownRows: [],
        sectionError: null,
        sectionSuccess: null,
        chartData
      }
    });
    const refreshButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("Refresh analytics"));
    await refreshButton!.trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  it("does not render the chart grid when analytics is null", () => {
    const wrapper = mount(AnalyticsView, {
      props: {
        filters,
        analytics: null,
        drilldownTitle: "",
        drilldownRows: [],
        sectionError: null,
        sectionSuccess: null,
        chartData
      }
    });
    expect(wrapper.findAll('[data-test="bar-chart"]').length).toBe(0);
  });

  it("renders three bar charts and drill-down rows when analytics is present", () => {
    const wrapper = mount(AnalyticsView, {
      props: {
        filters,
        analytics: { viewsByStation: chartData.stations },
        drilldownTitle: "Mobility",
        drilldownRows: [{ label: "Coach", value: "Default Coach" }],
        sectionError: null,
        sectionSuccess: null,
        chartData
      }
    });
    expect(wrapper.findAll('[data-test="bar-chart"]').length).toBe(3);
    expect(wrapper.text()).toContain("Mobility");
    expect(wrapper.text()).toContain("Default Coach");
  });

  it("falls back to an empty-state hint when no drill-down rows are present", () => {
    const wrapper = mount(AnalyticsView, {
      props: {
        filters,
        analytics: { viewsByStation: chartData.stations },
        drilldownTitle: "",
        drilldownRows: [],
        sectionError: null,
        sectionSuccess: null,
        chartData
      }
    });
    expect(wrapper.text()).toContain("Select a chart bar to inspect");
  });
});

describe("DashboardBuilderView", () => {
  const palette = [
    { widgetType: "members", title: "Members" },
    { widgetType: "content", title: "Content analytics" }
  ];

  it("emits addWidget with the widgetType and title of the clicked palette button", async () => {
    const wrapper = mount(DashboardBuilderView, {
      props: {
        widgetPalette: palette,
        layout: [],
        templateName: "",
        sectionError: null,
        sectionSuccess: null
      }
    });
    const addMembers = wrapper.findAll("button").find((b) => b.text() === "Add Members");
    await addMembers!.trigger("click");
    expect(wrapper.emitted("addWidget")?.[0]).toEqual(["members", "Members"]);
  });

  it("emits saveLayout and saveTemplate when the respective buttons are clicked", async () => {
    const wrapper = mount(DashboardBuilderView, {
      props: {
        widgetPalette: palette,
        layout: [],
        templateName: "Weekly",
        sectionError: null,
        sectionSuccess: null
      }
    });
    const saveLayout = wrapper.findAll("button").find((b) => b.text().includes("Save layout"));
    await saveLayout!.trigger("click");
    const saveTemplate = wrapper.findAll("button").find((b) => b.text().includes("Save template"));
    await saveTemplate!.trigger("click");
    expect(wrapper.emitted("saveLayout")).toHaveLength(1);
    expect(wrapper.emitted("saveTemplate")).toHaveLength(1);
  });

  it("emits removeWidget when the remove button is clicked for a widget", async () => {
    const wrapper = mount(DashboardBuilderView, {
      props: {
        widgetPalette: palette,
        layout: [
          { id: "w-1", widgetType: "members", title: "Members", x: 0, y: 0, width: 2, height: 2 }
        ],
        templateName: "",
        sectionError: null,
        sectionSuccess: null
      }
    });
    const removeButton = wrapper.findAll("button").find((b) => b.text() === "Remove");
    await removeButton!.trigger("click");
    expect(wrapper.emitted("removeWidget")?.[0]).toEqual(["w-1"]);
  });

  it("emits updateWidgetTitle when a widget title input changes", async () => {
    const wrapper = mount(DashboardBuilderView, {
      props: {
        widgetPalette: palette,
        layout: [
          { id: "w-1", widgetType: "members", title: "Members", x: 0, y: 0, width: 2, height: 2 }
        ],
        templateName: "",
        sectionError: null,
        sectionSuccess: null
      }
    });
    const widgetTitleInput = wrapper.findAll("input").find((i) => (i.element as HTMLInputElement).value === "Members");
    await widgetTitleInput!.setValue("Members (renamed)");
    const emitted = wrapper.emitted("updateWidgetTitle");
    expect(emitted?.[emitted.length - 1]).toEqual(["w-1", "Members (renamed)"]);
  });
});

describe("AdminConsoleView", () => {
  const consoleData = {
    metrics: {
      totalLogs: 42,
      openAlerts: 2,
      uptimeSeconds: 1234,
      averageRequestDurationMs: 12.5,
      serverErrorRate: 0.025,
      lastReportDurationMs: 800,
      lastBackupDurationMs: 910
    },
    recentLogs: [
      { category: "http", level: "warn", message: "Deprecated endpoint", createdAt: "2026-04-10" }
    ],
    recentAlerts: [
      {
        alertType: "storage_sync_error",
        severity: "high",
        message: "Shared folder write failed",
        createdAt: "2026-04-10"
      }
    ]
  };

  it("renders all metrics with their formatted values", () => {
    const wrapper = mount(AdminConsoleView, {
      props: {
        consoleData,
        backupResult: null,
        recoveryResult: null,
        dryRunBackupId: "",
        loadingBackup: false,
        loadingRecovery: false,
        sectionError: null
      }
    });
    expect(wrapper.text()).toContain("Total logs");
    expect(wrapper.text()).toContain("42");
    expect(wrapper.text()).toContain("12.5 ms");
    expect(wrapper.text()).toContain("2.5%");
    expect(wrapper.text()).toContain("910 ms");
  });

  it("emits backup when the Run backup button is clicked", async () => {
    const wrapper = mount(AdminConsoleView, {
      props: {
        consoleData,
        backupResult: null,
        recoveryResult: null,
        dryRunBackupId: "",
        loadingBackup: false,
        loadingRecovery: false,
        sectionError: null
      }
    });
    const runBackup = wrapper.findAll("button").find((b) => b.text().includes("Run backup"));
    await runBackup!.trigger("click");
    expect(wrapper.emitted("backup")).toHaveLength(1);
  });

  it("disables Dry-run restore when dryRunBackupId is empty", () => {
    const wrapper = mount(AdminConsoleView, {
      props: {
        consoleData,
        backupResult: null,
        recoveryResult: null,
        dryRunBackupId: "",
        loadingBackup: false,
        loadingRecovery: false,
        sectionError: null
      }
    });
    const dryRun = wrapper.findAll("button").find((b) => b.text().includes("Dry-run restore"));
    expect(dryRun?.attributes("disabled")).toBeDefined();
  });

  it("emits dryRun when the button is clicked and a backup id is present", async () => {
    const wrapper = mount(AdminConsoleView, {
      props: {
        consoleData,
        backupResult: null,
        recoveryResult: null,
        dryRunBackupId: "7",
        loadingBackup: false,
        loadingRecovery: false,
        sectionError: null
      }
    });
    const dryRun = wrapper.findAll("button").find((b) => b.text().includes("Dry-run restore"));
    await dryRun!.trigger("click");
    expect(wrapper.emitted("dryRun")).toHaveLength(1);
  });

  it("renders backup and recovery result cards when provided", () => {
    const wrapper = mount(AdminConsoleView, {
      props: {
        consoleData,
        backupResult: { id: 3, checksum: "abc123" },
        recoveryResult: { status: "passed", checksum: "xyz789" },
        dryRunBackupId: "3",
        loadingBackup: false,
        loadingRecovery: false,
        sectionError: null
      }
    });
    expect(wrapper.text()).toContain("ID: 3");
    expect(wrapper.text()).toContain("Checksum: abc123");
    expect(wrapper.text()).toContain("Status: passed");
    expect(wrapper.text()).toContain("xyz789");
  });

  it("renders the alerts panel and falls back to an empty state when no alerts are present", () => {
    const wrapper = mount(AdminConsoleView, {
      props: {
        consoleData: { ...consoleData, recentAlerts: [] },
        backupResult: null,
        recoveryResult: null,
        dryRunBackupId: "",
        loadingBackup: false,
        loadingRecovery: false,
        sectionError: null
      }
    });
    expect(wrapper.text()).toContain("No open anomaly alerts are currently surfaced");
  });

  it("surfaces section errors in a dedicated banner", () => {
    const wrapper = mount(AdminConsoleView, {
      props: {
        consoleData,
        backupResult: null,
        recoveryResult: null,
        dryRunBackupId: "",
        loadingBackup: false,
        loadingRecovery: false,
        sectionError: "Backup engine offline"
      }
    });
    expect(wrapper.text()).toContain("Backup engine offline");
  });
});
