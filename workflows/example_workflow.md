# Example Workflow

**Objective:** Demonstrate the workflow format. Replace this with real SOPs for your tasks.

## Required inputs

- None for this example. Real workflows will list what the agent must have (URLs, IDs, date ranges, etc.).

## Steps

1. **Check skills:** Confirm the right script exists in `skills/` for the task.
2. **Run tool:** Execute with required arguments (see tool's `--help`).
3. **Handle output:** Inspect result; if it's intermediate data, it goes to `.tmp/`. Final deliverables go to cloud services.

## Tools to use

- `skills/example_tool.py` — sample script. Real workflows reference specific tools by path.

## Expected outputs

- Success: Clear confirmation or path to output.
- Failure: Error message; agent fixes the tool or documents the issue and updates this workflow (with your approval).

## Edge cases

- **Missing inputs:** Ask the user before running.
- **Tool fails:** Read the trace, fix the script, retest. If it's an external limit (rate limit, auth), document it here.
- **Empty or unexpected response:** Log what was received; do not assume. Escalate or ask if unclear.
