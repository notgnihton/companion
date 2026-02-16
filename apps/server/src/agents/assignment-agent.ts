import { BaseAgent, AgentContext } from "../agent-base.js";

const deadlines = [
  { course: "Algorithms", task: "Problem Set 4", hoursLeft: 28 },
  { course: "Databases", task: "Schema Design Report", hoursLeft: 54 },
  { course: "Operating Systems", task: "Lab 3", hoursLeft: 12 }
];

export class AssignmentTrackerAgent extends BaseAgent {
  readonly name = "assignment-tracker" as const;
  readonly intervalMs = 20_000;

  async run(ctx: AgentContext): Promise<void> {
    // Check for overdue deadlines
    const store = ctx.getStore();
    const now = new Date();
    const overdueDeadlines = store.getDeadlines().filter((deadline) => {
      if (deadline.completed) {
        return false;
      }
      const dueDate = new Date(deadline.dueDate);
      return !isNaN(dueDate.getTime()) && dueDate < now;
    });

    // Emit overdue reminder for each overdue deadline
    for (const deadline of overdueDeadlines) {
      ctx.emit(this.event("assignment.overdue", deadline, "high"));
    }

    // Keep existing random deadline behavior for demo/testing
    const next = deadlines[Math.floor(Math.random() * deadlines.length)];
    const priority = next.hoursLeft <= 12 ? "critical" : next.hoursLeft <= 24 ? "high" : "medium";
    ctx.emit(this.event("assignment.deadline", next, priority));
  }
}
