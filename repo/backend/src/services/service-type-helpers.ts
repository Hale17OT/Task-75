import type { createContentService } from "./content-service.js";
import type { createDashboardService } from "./dashboard-service.js";

export type ReturnTypeOfCreateContentService = ReturnType<typeof createContentService>;
export type ReturnTypeOfCreateDashboardService = ReturnType<typeof createDashboardService>;

