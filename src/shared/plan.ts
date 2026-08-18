export interface PlannedAction {
  group: string;
  description: string;
}

export function printPlannedActions(
  header: string,
  actions: PlannedAction[],
  groupOrder: string[],
  footerLines: string[] = [],
): void {
  console.log(header);

  for (const group of groupOrder) {
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

  if (footerLines.length > 0) {
    console.log("");
    for (const line of footerLines) {
      console.log(line);
    }
  }
}
