## What this changes

<!-- One paragraph. What was wrong, and what is different now. -->

## Why

<!-- The problem, not the implementation. Link the issue: Closes #123 -->

## Milestone

<!-- M1–M6, or "none" for maintenance. See the Notion Milestones database. -->

---

## Checks

<!-- CI runs all of these. Ticking them locally first is faster than waiting for a red build. -->

- [ ] `npm run audit` passes — routes, guards, links, i18n parity, environment parity
- [ ] `npm --prefix frontend run build:prod` succeeds
- [ ] Commit messages follow Conventional Commits (commitlint enforces this)

### If this touches routes or links
- [ ] Every new route declares a `title` and `data.seo.description`
- [ ] Private routes carry `data: { seo: { noIndex: true } }`
- [ ] New public pages added to the sitemap in `backend/src/modules/seo/seo.controller.ts`
- [ ] Internal links keep the locale prefix (the URL serializer handles this — confirm it still does)

### If this touches copy
- [ ] Matches the approved wording in Notion → Website & Landing Page Copy
- [ ] Does not claim more than three published languages
- [ ] Does not claim listings or landlords are vetted — we verify identity where offered

### If this touches environments or config
- [ ] All three environment files define the same keys
- [ ] New backend config keys documented in `backend/.env.example`
- [ ] `SITE_URL` behaviour correct for staging (must stay non-indexable)

### If this adds tracking or analytics
- [ ] Cookie policy, consent flow and privacy policy updated **in this same PR**

<!--
Under POPIA, shipping the tracking first and fixing the policy afterwards is
the violation. The policy page is public evidence of what we promised.
-->

## How I verified this

<!-- What you actually ran or clicked. "Tested locally" is not an answer. -->

## Screenshots

<!-- For UI changes. Mobile viewport preferred — most of our traffic is on a phone. -->
