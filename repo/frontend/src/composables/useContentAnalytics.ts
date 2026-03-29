import { computed, reactive } from "vue";
import { parseMmDdYyyy } from "../utils/date";
import { useAuthStore } from "../stores/auth";
import type { ContentPost } from "../types";

type FeedbackSetter = (value: { error?: string | null; success?: string | null }) => void;

export const useContentAnalytics = (auth: ReturnType<typeof useAuthStore>, setFeedback: FeedbackSetter) => {
  const contentState = reactive({
    posts: [] as ContentPost[],
    analytics: null as Record<string, unknown> | null,
    postForm: { kind: "tip", title: "", body: "", locationCode: "HQ" },
    filters: { startDateText: "", endDateText: "", locationCode: "HQ", includeHistorical: false },
    searchTerm: "",
    selectedPostId: null as number | null,
    publishing: false,
    searching: false,
    refreshingAnalytics: false,
    viewingPostId: null as number | null
  });
  const analyticsDrilldown = reactive({
    title: "Select a chart",
    rows: [] as Array<{ label: string; value: string | number }>
  });

  const chartData = computed(() => ({
    stations: (contentState.analytics?.viewsByStation as Array<{ stationToken: string; views: number }>) ?? [],
    posts: (contentState.analytics?.topPosts as Array<{ title: string; views: number }>) ?? [],
    searches: (contentState.analytics?.searchTrends as Array<{ term: string; uses: number }>) ?? []
  }));

  const resetContentState = () => {
    contentState.posts = [];
    contentState.analytics = null;
    contentState.postForm = { kind: "tip", title: "", body: "", locationCode: "HQ" };
    contentState.filters = { startDateText: "", endDateText: "", locationCode: "HQ", includeHistorical: false };
    contentState.searchTerm = "";
    contentState.selectedPostId = null;
    contentState.publishing = false;
    contentState.searching = false;
    contentState.refreshingAnalytics = false;
    contentState.viewingPostId = null;
    analyticsDrilldown.title = "Select a chart";
    analyticsDrilldown.rows = [];
  };

  const loadContent = async () => {
    contentState.posts = (await auth.api().listPosts()).posts;
  };

  const loadAnalytics = async () => {
    const query = new URLSearchParams();
    const startDate = parseMmDdYyyy(contentState.filters.startDateText);
    const endDate = parseMmDdYyyy(contentState.filters.endDateText);

    if (contentState.filters.startDateText && !startDate) {
      throw new Error("Start date must use MM/DD/YYYY");
    }
    if (contentState.filters.endDateText && !endDate) {
      throw new Error("End date must use MM/DD/YYYY");
    }

    if (startDate) query.set("startDate", startDate);
    if (endDate) query.set("endDate", endDate);
    query.set("locationCode", contentState.filters.locationCode);
    query.set("includeHistorical", String(contentState.filters.includeHistorical));
    contentState.analytics = (await auth.api().analytics(query)).analytics as unknown as Record<string, unknown>;
    setFeedback({ success: "Analytics refreshed for the current date and station filters." });
  };

  const handleCreatePost = async () => {
    if (contentState.publishing) return;
    contentState.publishing = true;
    try {
      await auth.api().createPost(contentState.postForm);
      contentState.postForm = { kind: "tip", title: "", body: "", locationCode: "HQ" };
      await loadContent();
      setFeedback({ success: "Post published to the offline coaching feed." });
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Content publish failed" });
    } finally {
      contentState.publishing = false;
    }
  };

  const handleViewPost = async (postId: number, locationCode: string) => {
    if (contentState.viewingPostId === postId) return;
    contentState.viewingPostId = postId;
    try {
      contentState.selectedPostId = postId;
      await auth.api().recordView(postId, locationCode);
      setFeedback({ success: "Content view recorded for analytics attribution." });
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Content view tracking failed" });
    } finally {
      contentState.viewingPostId = null;
    }
  };

  const handleSearchContent = async () => {
    if (contentState.searching) return;
    contentState.searching = true;
    try {
      if (!contentState.searchTerm.trim()) {
        throw new Error("Enter a search term before recording an onsite search");
      }

      await auth.api().recordSearch(contentState.searchTerm, contentState.filters.locationCode);
      await loadAnalytics();
      setFeedback({ success: `Onsite search recorded for "${contentState.searchTerm}".` });
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Search event tracking failed" });
    } finally {
      contentState.searching = false;
    }
  };

  const handleRefreshAnalytics = async () => {
    if (contentState.refreshingAnalytics) return;
    contentState.refreshingAnalytics = true;
    try {
      await loadAnalytics();
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Analytics refresh failed" });
    } finally {
      contentState.refreshingAnalytics = false;
    }
  };

  const selectStationDrilldown = (index: number) => {
    const station = chartData.value.stations[index];
    analyticsDrilldown.title = station ? `Station drill-down: ${station.stationToken}` : "Station drill-down";
    analyticsDrilldown.rows = station
      ? [
          { label: "Station token", value: station.stationToken },
          { label: "Views", value: station.views },
          { label: "Linked posts", value: chartData.value.posts.map((post) => post.title).join(", ") || "No posts yet" }
        ]
      : [];
  };

  const selectPostDrilldown = (index: number) => {
    const post = chartData.value.posts[index];
    const details = contentState.posts.find((candidate) => candidate.title === post?.title);
    analyticsDrilldown.title = post ? `Post drill-down: ${post.title}` : "Post drill-down";
    analyticsDrilldown.rows = post
      ? [
          { label: "Title", value: post.title },
          { label: "Views", value: post.views },
          { label: "Body preview", value: details?.body ?? "No body found" }
        ]
      : [];
  };

  const selectSearchDrilldown = (index: number) => {
    const trend = chartData.value.searches[index];
    analyticsDrilldown.title = trend ? `Search drill-down: ${trend.term}` : "Search drill-down";
    analyticsDrilldown.rows = trend
      ? [
          { label: "Search term", value: trend.term },
          { label: "Onsite uses", value: trend.uses },
          { label: "Location filter", value: contentState.filters.locationCode }
        ]
      : [];
  };

  return {
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
  };
};
