# Workflow rules for this repo

This repo is owned by Aruna Harikant on GitHub. Follow this workflow for every change:

1. **Never commit or push directly to `main`.** Create a feature branch first:
   ```bash
   git checkout -b <your-name>/<short-description>
   ```
2. **Pull latest `main` before starting work** to avoid stale-branch conflicts:
   ```bash
   git pull origin main
   ```
3. **Write a clear description with every commit** — what changed and why, not just what file was touched.
4. **Push the branch and open a Pull Request** on GitHub rather than pushing to `main`:
   ```bash
   git push -u origin <your-name>/<short-description>
   ```
5. **Wait for the repo owner (Aruna Harikant) to review and approve** the PR before it merges into `main`.

This applies to all contributors, including changes made with Claude Code's help.
