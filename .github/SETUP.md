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

## Required: Personal Access Token for Workflow Triggering

Due to GitHub security restrictions, workflows triggered by `GITHUB_TOKEN` cannot trigger other workflows. To enable the full automation chain (PR creation → auto-rebase → auto-approve → auto-merge), you need to create a Personal Access Token (PAT).

### Steps to Create PAT

1. Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens:
   ```
   https://github.com/settings/tokens?type=beta
   ```

2. Click **"Generate new token"**

3. Configure the token:
   - **Name**: `companion-agent-automation`
   - **Repository access**: Select "Only select repositories" → Choose `lucyscript/companion`
   - **Permissions**:
     - Repository permissions:
       - Contents: **Read and write**
       - Pull requests: **Read and write**
       - Metadata: **Read-only** (automatically selected)

4. Click **"Generate token"** and **copy the token**

5. Add the token to your repository secrets:
   ```
   https://github.com/lucyscript/companion/settings/secrets/actions/new
   ```
   - **Name**: `AGENT_PAT`
   - **Secret**: Paste your token
   - Click **"Add secret"**

### Why This Is Needed

When `agent-auto-pr.yml` creates a PR, it needs to push a trigger commit to activate the automation workflows. Using `GITHUB_TOKEN` for this push would block the workflow chain, so we use a PAT instead.

**Fallback**: If `AGENT_PAT` is not set, the workflow will use `GITHUB_TOKEN`, but you'll need to manually push a commit to trigger the automation.

## Optional: Disable Branch Protection for Agent Branches

For auto-merge to work without manual approval, you may need to adjust branch protection rules:

1. Go to repository settings → Branches:
   ```
   https://github.com/lucyscript/companion/settings/branches
   ```

2. If you have branch protection rules on `main`:
   - Either: **Uncheck** "Require approvals" 
   - Or: Check "Allow specified actors to bypass required pull requests" and add `github-actions[bot]`

3. Alternative: Manually merge agent PRs after automated checks pass

**Note**: The workflow adds a comment instead of formal approval to avoid GitHub's "can't approve your own PR" restriction.

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
