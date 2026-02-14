# GitHub Actions Setup

## Required: Enable Workflow Permissions

The agent automation workflows require special permissions to create and manage pull requests.

### Steps to Enable

1. Go to your repository settings:
   ```
   https://github.com/lucyscript/companion/settings/actions
   ```

2. Scroll to **"Workflow permissions"**

3. Select **"Read and write permissions"**

4. **✅ Check** the box: **"Allow GitHub Actions to create and approve pull requests"**

5. Click **"Save"**

### Why This Is Needed

By default, GitHub Actions has read-only access and cannot:
- Create pull requests
- Approve pull requests
- Add labels
- Post comments

The agent workflows need these permissions to automate the entire PR lifecycle:
- `agent-auto-pr.yml` - Creates PRs automatically
- `agent-pr-automation.yml` - Approves and merges PRs

### Security Note

These permissions only apply to GitHub Actions workflows running in **this repository**. They cannot be used by external actors.

## Verification

After enabling permissions:

1. Push to an `agent/*` branch:
   ```bash
   git checkout -b agent/6-test-permissions
   echo "test" >> README.md
   git add README.md
   git commit -m "test: verify workflow permissions"
   git push -u origin agent/6-test-permissions
   ```

2. Check that the workflow succeeds:
   - Go to: https://github.com/lucyscript/companion/actions
   - The "Auto-create Agent PR" workflow should complete successfully
   - A PR should be automatically created

If it fails with "not permitted to create pull requests", the permissions weren't saved correctly.
