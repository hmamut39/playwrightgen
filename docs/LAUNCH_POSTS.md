# Three posts, ready to send

Drafts for showing PlaywrightGen to people. Read them, change anything that
does not sound like you, and post. Nothing here is published automatically.

Every number in these is measured, on production, on 2026-11-22. If somebody
checks one, it holds. That is the whole reason to use numbers instead of
adjectives: adjectives cannot be checked, so they are discounted.

**Order matters.** Post to Reddit first and the Playwright Discord next.
Both are forgiving, and the objections raised there are the ones Hacker News
will raise louder. Show HN last, once those have been answered.

---

## 1. Reddit — r/QualityAssurance, then r/Playwright a few days later

Read each subreddit's self-promotion rule first. Both allow sharing a tool
you built if you are present in the comments; neither forgives a drive-by
link. Post in the morning on a weekday, then stay for a few hours and answer
everything.

**Title**

> I built a free tool that writes a Playwright test from a real page and runs
> it until it passes. No account, about 20 seconds.

**Body**

> Every editor writes Playwright now. What none of them do is open the page
> and check that the test they wrote actually passes against it — so you get
> code with invented selectors that looks right and fails on first run.
>
> So I built the loop: paste a URL and what you want tested, and it reads the
> page's accessibility tree, writes the test from the real roles and names,
> runs it in a real browser, fixes the failing step from what the page
> actually showed, and runs it again. You get the code and the run.
>
> Timed this morning, button press to verdict:
>
> - TodoMVC demo: 20 seconds, passed, 2 checks
> - A real shop with 49 controls: 34 seconds, passed, 10 checks
> - A page behind a sign-in: 47 seconds, passed, 12 checks
>
> Free, no account, nothing to install: https://playwrightgen.com/generator
>
> Things it deliberately will not do, because I think they are where these
> tools lose trust:
>
> - A run that was partly skipped is not called "proven".
> - A failing test whose failure looks like a real product defect is not
>   quietly repaired — repairing it deletes the only warning you were going
>   to get.
> - No coverage percentage. One number hides which scenarios are actually
>   unverified.
> - Credentials you give it for a sign-in are used for that run, never
>   stored, and blanked out of everything the run reports.
>
> I am one person and this is the first time I have shown it to anybody. If
> it writes something stupid for your page, I would genuinely rather know —
> paste what you got and I will tell you whether it is fixable.

---

## 2. The Playwright Discord — #showcase or #general

Short. These are people who will try it in the next ten minutes or never.

> Built a free thing that might be useful here: paste a URL and a sentence,
> it reads the page, writes a Playwright test from the real roles and names,
> runs it in a real browser, fixes the failing step and runs again. You get
> the code and the passing run. No account.
>
> https://playwrightgen.com/generator
>
> 20 seconds on the TodoMVC demo, 47 behind a login. It will not call a
> partly-skipped run "proven", and it will not repair a test whose failure
> looks like a real defect.
>
> First time showing it to anyone — if it writes rubbish for your page I
> want to see it.

---

## 3. Show HN — last, after the first two

Show HN rewards a plain description and punishes marketing language. No
exclamation marks, no "revolutionary", no em-dash-heavy throat clearing. The
title has a hard limit of 80 characters.

**Title**

> Show HN: Playwright tests written from your real page and run until they pass

**Body (first comment, posted by you immediately after submitting)**

> Author here. Every editor assistant writes Playwright now, and none of them
> open the page to check the test passes, so you get plausible code with
> invented selectors.
>
> This does the loop: reads the page's accessibility tree, writes the test
> from the roles and names that are actually there, runs it in a remote
> browser, reads the failure, fixes the failing step, runs it again. Twenty
> seconds on the TodoMVC demo, 34 on a real shop, 47 on a page behind a
> sign-in — all measured today, all with the passing run shown.
>
> The free tools need no account: https://playwrightgen.com/generator
>
> The part I care more about is what it refuses to say. A partly-skipped run
> is not "proven". A failing test that looks like a real defect is not
> repaired. No coverage percentage is produced. If it had to assume
> something, it lists the assumption instead of quietly filling the gap.
>
> Behind the free tools there is a workspace that keeps the record a release
> decision actually needs: which behaviour was agreed, by whom, at which
> version, and what the last run proved. Tests run on your CI; only a bounded
> summary comes back, tied to the approved version it exercised.
>
> Built by one person. Known gaps: no Content-Security-Policy yet, no
> external security audit, and the billing side is deliberately switched off
> until the team platform is ready. I will be here all day.

---

## After posting

- Answer every comment, including the dismissive ones, and especially the
  person who says it wrote something wrong for their page. That person is
  worth more than the whole thread.
- When somebody reports a fault, `npm run feedback` shows what arrives
  through the site's own "Something wrong on this page?" link, with whether
  the notification mail actually left.
- Expect the first real usage to cost pennies: measured on production, a
  visitor cannot cost more than about fifteen cents in a week even spending
  every daily allowance in full.
