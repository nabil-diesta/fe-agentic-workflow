/** Extract Jira-style key (e.g. DD-1234) from task string. */
export function parseTicketKeyFromTask(task: string | undefined): string | null {
  if (!task) return null;
  const match = task.match(/\b([A-Z]{2,10}-\d+)\b/);
  return match ? match[1] : null;
}
