# Mode: outreach — find the hiring contact, draft the email, never send it

Turn a tracked role into a specific email to a specific person, saved as a
**Gmail draft** that the candidate reviews and sends themselves.

> **The rule this mode does not bend.** `modes/email.md`: *"Never submit. Never
> send email. Never click send."* Creating a draft is compatible with that.
> Calling Gmail's send is not, and `tests/outreach-guards.test.mjs` fails the
> build if any code path reaches for it.
>
> This is not timidity. An outreach email is the only artifact in this system
> that reaches a real person, under the candidate's name, irreversibly. A bad CV
> can be regenerated; a sent email cannot be unsent.

---

## Before anything: the two hard prerequisites

1. **`cv.md` must exist.** Without it there is no ground truth and the email
   becomes invention aimed at a hiring manager. `outreach-draft.mjs` refuses.
2. **The role must already be in the tracker**, evaluated, with a report. This
   mode writes an email *about a specific fit*; it has nothing to say about a
   role nobody has assessed.

If the score is below 4.0, stop and say so. `AGENTS.md`: *"Below 4.0/5,
explicitly recommend against applying."* Sending a stranger a pitch for a role
that scores 3.1 costs your credibility and their time.

## Step 1 — Find a real person

Use `modes/contacto.md`'s taxonomy: `hiring-manager`, `recruiter`, `peer`,
`interviewer`. In priority order:

1. The **hiring manager**, if the JD names a reporting line ("reports to the
   Director of Platform") — search the company's own site and LinkedIn *as a
   human reader* for who currently holds it.
2. The **recruiter** named on the posting.
3. A **peer** on the team who has published something about the work.

**Never address "Hiring Manager" or "To whom it may concern."** A message with
no addressee is a broadcast, and reads as one. `outreach-draft.mjs` requires a
name.

### The address rule

You must be able to point at **where the company published it**:
a team page, a press release, the JD itself, a conference bio, a public GitHub
commit. Record that page as `contact.source_url`.

**Never guess `firstname.lastname@company.com`.** Guessed addresses bounce,
damage your sending reputation, and are the exact mechanism by which outreach
becomes spam. The script refuses a contact with no `source_url` — not because
the field is bureaucracy, but because if you cannot say where you found it, you
did not find it.

If no address is publicly available: **stop and use LinkedIn instead**, via
`modes/contacto.md`. A connection request with a note is a legitimate channel
and does not require anyone's private email.

## Step 2 — Write the email

Read, in this order: the report in `reports/`, `cv.md`, `modes/_profile.md`,
`article-digest.md`. Everything you write comes from those.

**Length: under 150 words.** A hiring manager reads the first two lines and
decides. Anything past that is for the version they read after you've earned it.

Structure that works:

| Part | Content |
|---|---|
| Subject | The role, plus the single most specific thing you bring. Not "Application for Senior PM". |
| Line 1 | Why *them*, specifically — something from the JD or their product that a mass email could not contain. |
| Line 2-3 | The one closest proof point from `cv.md`, with its real number. |
| Line 4 | The gap you'd be asked about, named before they find it. This is what separates a credible note from a pitch. |
| Close | One concrete, low-cost ask. "Worth a 20-minute conversation?" not "I would welcome the opportunity to discuss." |

### Numbers

**Every figure must appear in `cv.md`.** The script extracts each number from
your body and checks it, and refuses the draft otherwise — the same rule
`negotiation-roi.mjs` applies to salary anchors, for the same reason: an
untraceable figure is one that was invented, and the reader cannot tell.

If a number is *the company's* (from the JD), state it qualitatively instead —
"a platform serving thousands of enterprise customers" rather than repeating a
figure you did not verify.

### The GCC signal changes the email

- **Product company** — lead with product judgement: a call you made, and what
  it cost or bought.
- **GCC** — lead with multi-market delivery and stakeholder alignment across
  time zones. Do not pitch roadmap ownership at a seat that does not have it;
  it reads as not having understood the role.
- **`unclear`** — ask. One line: *"Is this seat setting the roadmap or
  delivering against a global one?"* It is a good question, it shows you know
  the difference, and it gets you a real answer.

## Step 3 — Validate and record

```bash
node outreach-draft.mjs --stdin <<'JSON'
{
  "tracker": "042",
  "company": "Acme",
  "role": "Senior Product Manager",
  "contact": {
    "name": "Priya Sharma",
    "title": "Director of Product",
    "type": "hiring-manager",
    "email": "priya@acme.com",
    "source_url": "https://acme.com/about/leadership"
  },
  "subject": "...",
  "body": "..."
}
JSON
```

It refuses — writing nothing — when `cv.md` is missing, a number cannot be
traced, the address has no published source, the contact has no name, or this
contact has already been approached for this role. **A refusal is the tool
working.** Fix the draft; do not work around it.

On success it records the contact in `data/contacts.tsv` and the outreach in
`data/outreach-log.tsv`, and prints a `draft` object.

## Step 4 — Create the Gmail draft

Hand **only** the `draft` object to `mcp__Gmail__create_draft`:

```
to:      draft.to
subject: draft.subject
body:    draft.body
```

**`create_draft` and nothing else.** Never `send_message`, `reply`, or
`forward`. The draft lands in the candidate's Drafts folder; they open it, read
it, and press send. That takes seconds and keeps a human on the only
irreversible step.

If Gmail is not connected, write the draft to `output/outreach/{tracker}-{company}.md`
and say so. The pipeline is identical; only the last mile changes.

## Step 5 — Track it

```bash
node set-status.mjs {tracker} Applied --note "outreach drafted to {email}"
node followup-seed.mjs
```

`followup-seed.mjs` pins the first follow-up date so the approach enters the
normal cadence. Then `node followup-cadence.mjs` surfaces it when it is due —
**a second email is a follow-up, not a second first email**, and the script
refuses to draft twice for the same person and role.

## Step 6 — Report

```
| Tracker | Company | Role | Contact | Type | Draft | Follow-up due |
```

State plainly that the drafts are **unsent** and waiting in Gmail.

---

## Volume

There is no batch mode here, deliberately. `AGENTS.md`: *"A well-targeted
application to 5 companies beats a generic blast to 50."*

If asked to send to everyone in a scan, say no and explain: a hiring manager can
spot a templated approach instantly, it converts near zero, and it burns the
address you need for the roles you actually want. Offer to rank the shortlist by
score and write the top three properly instead.

## What this mode must never do

- **Never send, reply to, or forward** an email. Draft only.
- **Never email an address you cannot source to a published page.**
- **Never write a number that is not in `cv.md`.**
- **Never email the same person twice about the same role** — that is a
  follow-up, and it belongs in `data/follow-ups.md`.
- **Never scrape LinkedIn or Naukri** to find a contact. Read them as a human.
