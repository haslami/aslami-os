# Ultramind — School Command Center

Single-file app at `school/index.html`. Fall 2026, Missouri State.

## Opening it

**https://matrixcommandcenter.netlify.app/school/**

That is the whole answer on every device — desktop, laptop, iPhone. Nothing to
install, nothing to sync first, no server to start. On iPhone: open it, Share →
Add to Home Screen, and it behaves like an app.

**It is public.** No passcode, by choice. Anyone with the URL can read your
coursework, notes, and lessons. Nothing in it is a credential.

The app itself lives at `matrixcommandcenter/school/index.html` and deploys from a
`git push`. This `school/` folder holds the helper scripts and the feed data only.

### Offline / local fallback

`Open School.bat` still starts a local copy at `http://localhost:8777/school/`,
served from the same file. Useful if Netlify is down. Same data either way — it all
comes from the database.

## Sync

Data lives in Supabase — the same project and `matrix` table the Command Center
(`workspace`) and Matrix Ledger (`ledger`) use, in a row called `school`. Open the
page anywhere and it pulls the newest copy. Measured propagation: **~2 seconds** via
realtime, with a 30-second poll and a refresh on window focus as backstops.

A device with no local history adopts the cloud copy wholesale on its first pull.
That is what makes a new laptop or phone work with zero setup.

Sync state is always on screen — green "Synced 11:42 PM" in the sidebar, and a red
banner across every view if it drops. It will not fail quietly.

Newest write wins on the whole record, so don't edit the same thing on two devices
at the same minute.

Backups: **Export / Import JSON** in Settings, and an optional OneDrive folder copy
(Settings → OneDrive backup) if you want a file on disk.

Two things stay on the device on purpose:

- Your **Brightspace feed token**. The publishable key is visible in the page source,
  so anything in the cloud row is readable by anyone holding it. Paste the feed URL
  once per device.
- **Raw extracted text over 60 KB** per deck. The outline, terms, definitions, and
  flashcards all sync; only the full "Raw text" tab is trimmed in transit, and a
  trimmed copy never overwrites full text a device already has.

## Brightspace

Due dates come from Brightspace's iCal feed. It is seeded with 217 Fall 2026
events already, so it works out of the box. To refresh:

1. Brightspace → any course → Calendar → **Subscribe** → copy the URL.
2. Settings → paste it → **Try URL sync**.

Brightspace sends no CORS header, so the browser cannot read that URL directly.
`serve.ps1` proxies it at `/api/ics` — which is why the localhost URL matters.
The fallback is the **Download** button in that same Brightspace dialog: drop the
`.ics` file into Settings and it parses locally.

The feed carries no submission status. Anything past due shows until you check it
off; checking it off is what makes it stay gone.

**FIN 384 publishes no calendar events.** Nothing can sync for it. Its work has to
be checked in Brightspace directly.

## Teach me — the daily lesson

Claude writes lessons and pushes them straight into your dashboard. They appear
under **Teach me**, one at a time, aimed at whichever exam is closest. Hit
**Done — next lesson** to advance; the streak counts consecutive days.

**How to get more lessons.** Two ways:

1. **Ask Claude in a session.** Say what you uploaded and which exam. Claude writes
   the lessons and runs:
   ```
   powershell -ExecutionPolicy Bypass -File push-lessons.ps1 -Path lessons.json
   ```
   They show up in an open dashboard in about two seconds. `-Replace` clears the
   queue instead of merging.
2. **Copy/paste.** Teach me → **Ask Claude for more lessons** copies your uploaded
   material plus exam dates. Paste to Claude, then paste the JSON back into
   Settings → **Load lessons from Claude**.

If the queue is empty, the page builds a rough lesson from your own slides so it's
never blank — it's labelled *auto-built*. That is a stopgap, not teaching.

**What limits the teaching:** Claude only sees what you upload. If a professor
stresses something in lecture that isn't in a deck or a study guide, it cannot know.
Study guides matter most — tag them as such on upload and everything gets built
around them.

## Study Lab

Pick **class**, **unit**, and **what the file is** (study guide / lecture deck /
notes / syllabus), then drop a `.pptx`, `.pdf`, `.docx`, or `.txt`.

**Units come from each course's own schedule** — nothing to set up:

| Course | Units |
|---|---|
| LAW 532 | Unit I · Agency & Employment, Exam 2 · Property, Unit III · Business Organizations |
| MKT 364 | Ch 1–2, Ch 3–4, Ch 5–8, Ch 9–12, Ch 13–16 (the chapter-test clusters) |
| LAW 332 | Week 1 … Week 7, each with its topic |
| FIN 380 | Exam 1, Exam 2, Exam 3 |
| FIN 266 / FIN 384 | General — these publish almost nothing to the calendar |

The unit whose exam is next is pre-selected and marked **studying now**. `+ new unit…`
adds your own. Material lists group by class → unit, in semester order.

Filed something wrong? Open the material and change class, unit, or type under
**Filed under**.

Tagging matters: a study guide is treated as the answer key, gets the most room in
the lesson prompt, and everything else is built around it.

Everything is parsed in the browser — no upload, no server. You get an outline, key terms, definitions, flashcards, and
a study method chosen from that file's actual shape (formula-heavy → worked
problems, definition-dense → term drilling, etc).

Two buttons hand off to Claude when you want real teaching rather than recall:

- **Copy "teach me this"** on a material — full source text plus a teaching brief.
- **Copy cram-plan prompt** on an exam — days remaining, uploaded material, and
  extracted terms.

Paste either into Claude.

## Privacy

`school/` is in `.gitignore`. Coursework, notes, and any feed token stay on disk
and in OneDrive, never in the `aslami-os` repo.
