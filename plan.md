# Plan: Rename LandingPage to Dashboard

## Summary
Rename the existing `LandingPage` component (the project overview shown after login) to `Dashboard`. This is a pure rename — no functional changes.

## Changes

### 1. Rename the file
- `components/LandingPage.tsx` → `components/Dashboard.tsx`

### 2. Update the component name inside the file
- Rename interface `LandingPageProps` → `DashboardProps`
- Rename export `LandingPage` → `Dashboard`

### 3. Update imports in `App.tsx`
- Change `import { LandingPage } from './components/LandingPage'` → `import { Dashboard } from './components/Dashboard'`
- Change `<LandingPage ...>` → `<Dashboard ...>` in JSX

### 4. Update version text
- Change `v6.0` → `v6.1` in the dashboard footer (since CLAUDE.md says we're on v6.1)

That's it — 2 files touched, pure rename. No functional changes.
