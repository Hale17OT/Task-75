import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthShell from "../src/components/AuthShell.vue";
import CameraCapturePanel from "../src/components/CameraCapturePanel.vue";
import FaceImageAnnotator from "../src/components/FaceImageAnnotator.vue";
import FaceOpsView from "../src/components/FaceOpsView.vue";
import OverviewView from "../src/components/OverviewView.vue";
import ReportsView from "../src/components/ReportsView.vue";

const flushPromises = async () => {
  await Promise.resolve();
  await nextTick();
};

const { mockTensor } = vi.hoisted(() => {
  const tensor = {
    shape: [10, 10],
    mean: vi.fn(),
    slice: vi.fn(),
    sub: vi.fn(),
    abs: vi.fn(),
    add: vi.fn()
  };

  tensor.mean.mockReturnValue(tensor);
  tensor.slice.mockReturnValue(tensor);
  tensor.sub.mockReturnValue(tensor);
  tensor.abs.mockReturnValue(tensor);
  tensor.add.mockReturnValue(tensor);

  return { mockTensor: tensor };
});

vi.mock("@tensorflow/tfjs", () => ({
  browser: {
    fromPixelsAsync: vi.fn().mockResolvedValue(mockTensor)
  },
  moments: vi.fn(() => ({
    mean: {},
    variance: {
      dataSync: () => [144]
    }
  })),
  dispose: vi.fn()
}));

class MockImage {
  src = "";

  decode() {
    return Promise.resolve();
  }
}

class MockFileReader {
  result: string | ArrayBuffer | null = "data:image/png;base64,imported";
  error: DOMException | null = null;
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;

  readAsDataURL() {
    this.onload?.();
  }
}

beforeEach(() => {
  vi.stubGlobal("Image", MockImage);
  vi.stubGlobal("FileReader", MockFileReader);
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined)
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AuthShell", () => {
  it("renders the bootstrap branch when first administrator setup is required", () => {
    const wrapper = mount(AuthShell, {
      props: {
        currentUser: null,
        sessionSecret: null,
        hasPin: false,
        bootstrapRequired: true,
        error: null,
        loading: false,
        stationToken: "",
        form: {
          username: "",
          password: "",
          pin: "",
          bootstrapFullName: ""
        }
      }
    });

    expect(wrapper.text()).toContain("First administrator setup");
    expect(wrapper.text()).toContain("Create administrator");
  });

  it("renders the warm-lock PIN branch for same-station resume", () => {
    const wrapper = mount(AuthShell, {
      props: {
        currentUser: {
          id: 1,
          username: "admin",
          fullName: "System Administrator",
          roles: ["Administrator"]
        },
        sessionSecret: null,
        hasPin: true,
        bootstrapRequired: false,
        error: null,
        loading: false,
        stationToken: "Front-Desk-01",
        form: {
          username: "",
          password: "",
          pin: "",
          bootstrapFullName: ""
        }
      }
    });

    expect(wrapper.text()).toContain("Resume with PIN");
    expect(wrapper.text()).toContain("same station");
  });

  it("emits bootstrap, login, reenter, and station token updates from the auth shell", async () => {
    const bootstrapWrapper = mount(AuthShell, {
      props: {
        currentUser: null,
        sessionSecret: null,
        hasPin: false,
        bootstrapRequired: true,
        error: null,
        loading: false,
        stationToken: "Desk-A",
        form: {
          username: "setup-admin",
          password: "Admin12345!X",
          pin: "",
          bootstrapFullName: "Setup Admin"
        }
      }
    });

    const bootstrapInputs = bootstrapWrapper.findAll("input");
    await bootstrapInputs[3].setValue("Desk-B");
    await bootstrapWrapper.get("button").trigger("click");

    expect(bootstrapWrapper.emitted("update:stationToken")?.[0]).toEqual(["Desk-B"]);
    expect(bootstrapWrapper.emitted("bootstrap")).toHaveLength(1);

    const loginWrapper = mount(AuthShell, {
      props: {
        currentUser: null,
        sessionSecret: "secret",
        hasPin: false,
        bootstrapRequired: false,
        error: null,
        loading: false,
        stationToken: "Desk-A",
        form: {
          username: "coach",
          password: "Coach12345!X",
          pin: "",
          bootstrapFullName: ""
        }
      }
    });

    await loginWrapper.get("button").trigger("click");
    expect(loginWrapper.emitted("login")).toHaveLength(1);

    const reenterWrapper = mount(AuthShell, {
      props: {
        currentUser: {
          id: 1,
          username: "member",
          fullName: "Gym Member",
          roles: ["Member"]
        },
        sessionSecret: null,
        hasPin: true,
        bootstrapRequired: false,
        error: null,
        loading: false,
        stationToken: "Desk-A",
        form: {
          username: "",
          password: "",
          pin: "1234",
          bootstrapFullName: ""
        }
      }
    });

    await reenterWrapper.get("button").trigger("click");
    expect(reenterWrapper.emitted("reenter")).toHaveLength(1);
  });

  it("renders an immediate duplicate warning banner before final submission", () => {
    const wrapper = mount(FaceOpsView, {
      props: {
        members: [{ id: 1, username: "member", fullName: "Member", phoneMasked: null, phoneLast4: null, locationCode: "HQ", notes: null, active: true, coachUserId: null, faceConsentStatus: "granted" }],
        selectedMemberId: 1,
        centerImageBase64: "",
        turnImageBase64: "",
        centerSourceType: "import",
        turnSourceType: "import",
        centerAnnotation: null,
        turnAnnotation: null,
        dedupPreview: { memberUserId: 88, similarity: 0.98 },
        dedupChecking: false,
        challengeIssuedAt: null,
        challengeExpiresAt: null,
        result: null,
        history: [],
        auditTrail: [],
        sectionError: null,
        sectionSuccess: null
      }
    });

    expect(wrapper.text()).toContain("Duplicate warning");
    expect(wrapper.text()).toContain("member 88");
  });

  it("renders a privacy-safe duplicate warning when match details are redacted", () => {
    const wrapper = mount(FaceOpsView, {
      props: {
        members: [{ id: 1, username: "member", fullName: "Member", phoneMasked: null, phoneLast4: null, locationCode: "HQ", notes: null, active: true, coachUserId: null, faceConsentStatus: "granted" }],
        selectedMemberId: 1,
        centerImageBase64: "",
        turnImageBase64: "",
        centerSourceType: "import",
        turnSourceType: "import",
        centerAnnotation: null,
        turnAnnotation: null,
        dedupPreview: { redacted: true, similarity: 0.93 },
        dedupChecking: false,
        challengeIssuedAt: null,
        challengeExpiresAt: null,
        result: null,
        history: [],
        auditTrail: [],
        sectionError: null,
        sectionSuccess: null
      }
    });

    expect(wrapper.text()).toContain("outside your access scope");
    expect(wrapper.text()).not.toContain("member undefined");
  });

  it("emits face-ops actions for member selection, refresh, enroll, and deactivate", async () => {
    const wrapper = mount(FaceOpsView, {
      props: {
        members: [{ id: 1, username: "member", fullName: "Member", phoneMasked: null, phoneLast4: null, locationCode: "HQ", notes: null, active: true, coachUserId: null, faceConsentStatus: "granted" }],
        selectedMemberId: 1,
        centerImageBase64: "",
        turnImageBase64: "",
        centerSourceType: "import",
        turnSourceType: "camera",
        centerAnnotation: { blurScore: 14, faceInFrame: true },
        turnAnnotation: { blurScore: 15, faceInFrame: true },
        dedupPreview: null,
        dedupChecking: true,
        challengeIssuedAt: "2026-03-28T10:00:00.000Z",
        challengeExpiresAt: "2026-03-28T10:00:30.000Z",
        result: { blurScore: 14, livenessScore: 0.93, duplicateWarning: { memberUserId: 44, similarity: 0.97 } },
        history: [{ faceRecordId: 44, versionNumber: 1, status: "active", blurScore: 14, livenessScore: 0.93 }],
        auditTrail: [{ createdAt: "2026-03-28T10:00:00.000Z", eventType: "enrolled", actorName: "Coach User" }],
        sectionError: "Needs review",
        sectionSuccess: "Enrollment saved"
      }
    });

    await wrapper.get("select").setValue("1");
    await wrapper.get("button").trigger("click");
    const allButtons = wrapper.findAll("button");
    await allButtons.find((button) => button.text() === "Submit face enrollment")?.trigger("click");
    await allButtons.find((button) => button.text() === "Deactivate")?.trigger("click");

    expect(wrapper.text()).toContain("Checking local duplicate warnings");
    expect(wrapper.text()).toContain("Enrollment saved");
    expect(wrapper.text()).toContain("Needs review");
    expect(wrapper.text()).toContain("Duplicate warning raised");
    expect(wrapper.emitted("update:selectedMemberId")).toBeUndefined();
    expect(wrapper.emitted("refreshHistory")).toHaveLength(1);
    expect(wrapper.emitted("enroll")).toHaveLength(1);
    expect(wrapper.emitted("deactivate")?.[0]).toEqual([44]);
  });

  it("captures from the workstation camera and emits audit source metadata", async () => {
    const trackStop = vi.fn();
    const mediaStream = {
      getTracks: () => [{ stop: trackStop }]
    } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(mediaStream);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia }
    });

    const originalCreateElement = document.createElement.bind(document);
    const drawImage = vi.fn();
    const getContext = vi.fn().mockReturnValue({ drawImage });
    const toDataURL = vi.fn().mockReturnValue("data:image/png;base64,captured");
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext,
          toDataURL
        } as unknown as HTMLCanvasElement;
      }

      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    const wrapper = mount(CameraCapturePanel, {
      attachTo: document.body,
      props: {
        label: "Center capture",
        modelValue: "",
        sourceType: "import"
      }
    });

    await wrapper.get("button").trigger("click");
    await flushPromises();

    const video = wrapper.get("video");
    Object.defineProperty(video.element, "videoWidth", { configurable: true, value: 640 });
    Object.defineProperty(video.element, "videoHeight", { configurable: true, value: 480 });

    await wrapper.get("div.border-t button").trigger("click");

    expect(getUserMedia).toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalled();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["data:image/png;base64,captured"]);
    expect(wrapper.emitted("update:sourceType")?.[0]).toEqual(["camera"]);
    expect(trackStop).toHaveBeenCalled();
  });

  it("imports a file and marks the source as import", async () => {
    const wrapper = mount(CameraCapturePanel, {
      props: {
        label: "Turn capture",
        modelValue: "",
        sourceType: "camera"
      }
    });

    const fileInput = wrapper.get('input[type="file"]');
    Object.defineProperty(fileInput.element, "files", {
      configurable: true,
      value: [new File(["image"], "face.png", { type: "image/png" })]
    });
    await fileInput.trigger("change");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["data:image/png;base64,imported"]);
    expect(wrapper.emitted("update:sourceType")?.[0]).toEqual(["import"]);
  });

  it("collects landmarks, computes blur guidance, and can reset annotations", async () => {
    const wrapper = mount(FaceImageAnnotator, {
      props: {
        label: "Center quality gates",
        modelValue: "data:image/png;base64,annotate"
      }
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Quality gate passed");

    const preview = wrapper.get(".relative");
    vi.spyOn(preview.element, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      top: 0,
      right: 100,
      bottom: 100,
      left: 0,
      toJSON: () => ({})
    });

    await preview.trigger("click", { clientX: 10, clientY: 20 });
    await preview.trigger("click", { clientX: 50, clientY: 20 });
    await preview.trigger("click", { clientX: 30, clientY: 60 });
    await flushPromises();

    expect(wrapper.text()).toContain("Face-in-frame guidance ready");
    const payload = wrapper.emitted("update")?.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.faceInFrame).toBe(true);
    expect(payload.landmarks).toBeTruthy();
    expect(payload.faceBox).toBeTruthy();

    await wrapper.get("button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Mark the face to continue");
  });

  it("emits overview actions for PIN save and self-consent controls", async () => {
    const wrapper = mount(OverviewView, {
      props: {
        currentUser: {
          id: 7,
          username: "member",
          fullName: "Member User",
          roles: ["Member"]
        },
        stationToken: "Front-Desk-01",
        hasPin: true,
        newPin: "1234",
        memberSelf: {
          id: 7,
          username: "member",
          fullName: "Member User",
          phoneMasked: null,
          phoneLast4: null,
          locationCode: "HQ",
          notes: null,
          active: true,
          coachUserId: null,
          faceConsentStatus: "declined"
        }
      }
    });

    await wrapper.get("input[placeholder='Set 4-6 digit PIN']").setValue("2222");
    await wrapper.get("button").trigger("click");
    const buttons = wrapper.findAll("button");
    await buttons.find((button) => button.text().includes("Grant my consent"))?.trigger("click");
    await buttons.find((button) => button.text().includes("Decline consent"))?.trigger("click");

    expect(wrapper.emitted("update:newPin")?.at(-1)).toEqual(["2222"]);
    expect(wrapper.emitted("savePin")).toHaveLength(1);
    expect(wrapper.emitted("ownConsent")).toHaveLength(2);
  });

  it("emits reports actions for schedule/create/download controls", async () => {
    const wrapper = mount(ReportsView, {
      props: {
        templates: [{ id: 1, name: "Weekly", layout: [], createdAt: "2026-03-28T00:00:00.000Z" }],
        recipients: [{ id: 1, username: "admin", fullName: "System Administrator", roles: ["Administrator"] }],
        schedules: [],
        inbox: [{
          id: 50,
          title: "Weekly report",
          fileName: "report.csv",
          status: "delivered",
          deliveredAt: "2026-03-28T01:00:00.000Z",
          reportRunId: 10
        }],
        scheduleForm: {
          scheduleName: "Weekly run",
          templateId: 1,
          cronExpression: "0 6 * * 1",
          scheduleFormat: "csv",
          generateFormat: "csv",
          subscriberUserIds: [1]
        },
        sectionError: null,
        sectionSuccess: null,
        creatingSchedule: false,
        generatingReport: false,
        downloadingInboxId: null,
        lastGeneratedReport: null,
        lastScheduledReport: null
      }
    });

    const buttons = wrapper.findAll("button");
    await buttons.find((button) => button.text().includes("Create schedule"))?.trigger("click");
    await buttons.find((button) => button.text().includes("Generate now"))?.trigger("click");
    await buttons.find((button) => button.text().includes("Download"))?.trigger("click");

    expect(wrapper.emitted("createSchedule")).toHaveLength(1);
    expect(wrapper.emitted("generate")).toHaveLength(1);
    expect(wrapper.emitted("download")?.[0]).toEqual([50]);
  });
});
