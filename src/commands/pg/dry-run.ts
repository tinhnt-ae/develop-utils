export type PlannedActionGroup = "Docker" | "PostgreSQL" | "Files";

export interface PlannedAction {
  group: PlannedActionGroup;
  description: string;
}

export function printPlannedActions(actions: PlannedAction[]): void {
  const groups: PlannedActionGroup[] = ["Docker", "PostgreSQL", "Files"];

  console.log("DRY RUN PostgreSQL local provisioning plan:");

  for (const group of groups) {
    const groupActions = actions.filter((action) => action.group === group);

    if (groupActions.length === 0) {
      continue;
    }

    console.log("");
    console.log(`${group}:`);
    for (const action of groupActions) {
      console.log(`  - ${action.description}`);
    }
  }

  console.log("");
  console.log("No Docker commands, SQL statements, or files were changed.");
  console.log("Rerun without --dry-run to approve and apply this plan.");
}
