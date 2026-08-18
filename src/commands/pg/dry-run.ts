import { printPlannedActions as printPlan, type PlannedAction as SharedPlannedAction } from "../../shared/plan.js";

export type PlannedActionGroup = "Docker" | "PostgreSQL" | "Files";

export interface PlannedAction extends SharedPlannedAction {
  group: PlannedActionGroup;
}

const GROUP_ORDER: PlannedActionGroup[] = ["Docker", "PostgreSQL", "Files"];

export function printPlannedActions(actions: PlannedAction[]): void {
  printPlan("DRY RUN PostgreSQL local provisioning plan:", actions, GROUP_ORDER, [
    "No Docker commands, SQL statements, or files were changed.",
    "Rerun without --dry-run to approve and apply this plan.",
  ]);
}
