---
name: trenitalia-commute
description: Book free abbonamento / Carta Tutto Treno seat reservations on lefrecce.it for a daily two-leg train commute described in a personal config file (stations, service type and time window per leg, fare code, traveller, seat preferences). Use when asked to reserve, book or hold commute trains for one or more workdays, to check which commute days are already booked, or to repeat the daily reservation. Reads the account state first, books only the missing legs, matches trains by service type and time window, never pays, stops cleanly when the entitlement has lapsed, and ends every run with a report.
---

# Trenitalia commute booking

Books a daily commute as **free abbonamento seat reservations (€0.00)**, not paid tickets. Choosing the wrong
fare turns a €0.00 reservation into a €9.00–€12.50 purchase, so the fare step (§4.2) matters most.

**Run order:** config (§1) → account state (§2) → plan and confirm (§3) → book each missing leg (§4) →
verify (§5) → report (§7). The rules in §0 hold in every step.

`{traveller.firstName}`, `{leg.offerName}` and similar placeholders in this file mean: read the value from the
config file (§1). This file holds no personal data; never write any into it.

---

## 0. Rules that always hold

- **Total not €0.00 → stop.** A price means the fare did not take or the entitlement lapsed (§6). Never click
  through a priced total, never fall back to a paid fare.
- **Never re-book a leg that already has a PNR.** Read the account state first (§2).
- **Never substitute the service.** If the configured `service` (for example `IC`, `FB`) has no train in the leg's
  time window, report that day; never take a Regionale or another train instead.
- **The password is never yours to handle.** Never type, read, ask for, store or repeat it. Signing in is done by
  the script from the credential the user saved in the OS (README), or by the user in the browser.
- **Accepting the conditions of carriage is a legal act.** The user's request to book is the authorisation for
  the days the account shows as `to-book` (§2.1b); never accept them for anything else (a priced fare, another
  train, a day outside the request).
- **Do not ask which days to book**: they come from the account (§3). State the plan in the report, then book.
- **An abandoned cart costs nothing**; the hold expires by itself. When something looks wrong, walk away.
- Personal data (names, card numbers, PNRs) stays in the private config, browser profile, local run files and
  report to the user. Never write it into this skill folder. Failure screenshots may contain personal data;
  keep them in the private state folder and review them before sharing.

---

## 1. Configuration

Personal file: `~/.trenitalia-commute/config.json` (Windows: `%USERPROFILE%\.trenitalia-commute\config.json`),
or the path in the environment variable `TRENITALIA_COMMUTE_CONFIG`. The same folder holds the script's browser
profile, run logs and recordings. Nothing personal lives in the skill folder, so the skill folder can be shared
as it is.

If the file is missing on Windows: run `scripts/setup.ps1` in a local interactive PowerShell terminal.
It asks the user for the traveller, card, stations, both train services and time windows, free offer names/IDs,
seat preferences, and the Le Frecce username and password. The password prompt is hidden and saves a
Windows-encrypted credential; never ask the user to type a password in chat. Verify the account with `login`
and `status` after setup. Outside Windows, copy `config.example.json` and ask for its required values, then
use the environment credential described in `README.md`.

| Field | Meaning |
|---|---|
| `traveller.firstName`, `traveller.lastName` | passenger name, also the name the site shows in the header when signed in |
| `traveller.tuttoTrenoCardNumber` | "Numero carta tutto treno", typed into the fare block of each leg |
| `stations.<key>` | exact station names as the site lists them |
| `legs[]` | one entry per direction: `id`, `from`, `to` (station keys), `service` (train acronym: `IC`, `FB`, `FR`…), `departAfter`/`departBefore` (`HH:mm` window), `offerName` and `offerId` (the free fare) |
| `seats` | preferred carriages, seat rules in priority order, `knownGood` seats per train |
| `window` | `workingDays` (default 20), `weekdays` (0 = Sunday … 6 = Saturday; default 1–5), `extraHolidays` (`YYYY-MM-DD` or yearly `MM-DD`, for example a patron saint), `minutesBeforeDeparture` |

Each direction is its own reservation with its own PNR, so a day can be half-booked.

**The train number and minute drift** when Trenitalia changes the timetable. That is why the config holds a
service type and a time window, not a train number or a minute.
Read whatever number the site shows, use it, and report it if it differs from `knownGood`.

---

## 2. Account state and sign-in

### 2.1 Fast path: the script (preferred)

```
node <skill folder>/scripts/commute.mjs status
```

Needs Node 18+, Google Chrome and a one-time `npm install` in `scripts/` (README). In about 15 seconds it signs in
if needed, reads the account's trips through the site's own API (no scrolling), finds the matching train for
every workday and leg, and prints one JSON line (the readable table goes to stderr). It books nothing.

Per row: `day`, `leg`, `state`, plus `train`/`departure` or `pnr`.

| `state` | Meaning | Action |
|---|---|---|
| `booked` | the account already holds this leg (`pnr`) | skip |
| `to-book` | not booked, matching train found (`train`, `departure`) | book (§4) |
| `departed` | today, departure already passed or too close | skip, say so |
| `no-matching-train` | no `service` train in the window; `seen` lists what runs | report, do not substitute |
| `unknown-not-signed-in` | train found, account not readable | sign in (below), run again |
| `search-error` | the site's search failed | run again; if it persists, use §2.2 |

Exit code `2` = not signed in. Sign in yourself: run `node <skill folder>/scripts/commute.mjs login`. It opens
Chrome on the script's own profile and signs in from the saved credential; the session is kept for later runs.
Then run `status` again.

- `login` finds no saved credential: ask the user once to run `scripts/save-credential.ps1` (they type username
  and password into its hidden local prompt; Windows encrypts the file for their user only), then run `login` again.
- Credential rejected, CAPTCHA, OTP or any other challenge: stop and report the exact message. Do not retry in a
  loop; the user can sign in by hand in the window `login` opens (it waits 5 minutes).

Exit code `1`: read `step` and `error`. If `trips.sample` is set, the trip list arrived but could not be parsed:
report the file path, do not guess, and use §2.2 for this run.

### 2.1b Fast path: booking with the script

```
node <skill folder>/scripts/commute.mjs book --count=<days>            # dry run: stops on the payment page
node <skill folder>/scripts/commute.mjs book --count=<days> --confirm  # books, after the user's yes
```

`book` does §4 by itself for the next days whose legs are all `to-book` (it re-reads the account before each
day): search, free fare per leg (with the retry of §4.3), traveller and card data, seats (§4.4: `knownGood` first,
then the rules), cart check through the site's cart API (both free offers present), and with `--confirm` the
conditions of carriage, the contact modal, the success page, the run log and the proof from the trip list.
Any total other than €0,00, a refusal (§6) or an unexpected page stops it with `step`, `error` and a screenshot
in `evidence`.

1. **Do not ask which days.** The days come from the account: `book` takes the next days whose legs are all
   `to-book`, in order. A request to book ("book my commute", "reserve two days") is the user's authorisation
   for those days, including the conditions of carriage; a number in the request is `--count`, otherwise book
   every such day in the window. Use `--until=YYYY-MM-DD` when the request has an end date, so no later day
   can enter the booking loop. So run `--confirm` directly.
2. Use the dry run (no `--confirm`) only when the user asks to see or test without booking.
3. Report `booked[]`: day, trains, seats, `pnr`, `verifiedLegs`.

Half-booked days (only one leg free) are skipped by the normal `book` run. When the user wants the remaining
leg alone, use `book --on=YYYY-MM-DD --leg=<leg id> --count=1 --confirm`; it restricts the account check,
search, cart and confirmation to that one date and leg. The same command handles a date when only one of the
configured train services runs. Do not book the other leg or substitute another service without authorisation.
A dry-run cart keeps its seats until it expires (about 10 minutes): a real run right after it sees those seats as
taken and picks others. The trip list shows a new booking only after some
seconds; `book` waits up to 90 s for it.

### 2.2 Browser path (when the script cannot run)

1. Open `https://www.lefrecce.it/Channels.Website.WEB/` and check the header shows
   `{traveller.firstName} {traveller.lastName}` in capitals. Signed out, or another account: ask the user to sign
   in and wait. Discard any search made while signed out.
2. Open **Area riservata → I miei viaggi** (route `#/user-area/purchases`) and **hard-reload** it: the panel is
   cached and can omit a reservation made minutes ago elsewhere. Stale lists are how duplicates happen.
3. Click **Vedi tutti**, then scroll to the bottom repeatedly. The list loads 10 entries at a time; while
   `Loading later solutions...` shows, scroll again. Stop only when the number of cards stays the same for two
   scroll-and-wait cycles. A list that ends on an early date is not proof that later dates are empty.
4. Read every entry tagged **`PRENOTAZIONE ABBONAMENTO`**: date, direction, departure time, PNR. Prefer
   `get_page_text` / `read_page` over screenshots.

---

## 3. Plan

1. Target days: the next `window.workingDays` working days from today. The script already drops weekends,
   Italian national holidays (including Easter Monday and, from 2026, 4 October) and `extraHolidays`.
2. Book only rows in state `to-book`. Every leg is independent: a day with only the outbound still needs its
   return.
3. **State the plan, do not ask for it**: which days and legs you book, which you skip and why. The days are
   the account's gap, not a question for the user. Then work the list one day at a time.
4. If nothing is `to-book`, book nothing and say so. Finding no work is a complete outcome.

---

## 4. Booking flow (browser), one day at a time

Work from the **homepage search form**, not the mini-widget in Area riservata.

### 4.1 Search

First day of a run (the form remembers the rest afterwards; then only the date changes):

1. **Da dove parti? / From**: type the station name **minus its last character** (the full name suppresses the
   autocomplete), wait about 2 s for `SUGGERIMENTI`, click the exact station.
2. **Dove vuoi andare? / To**: same.
3. **+ RITORNO / + RETURN**. This sometimes **clears the destination**: re-check both station fields.

Every day:

4. Open **Data di Partenza** and click the target day **once**; outbound and return should both take that day.
   **Range-picker trap:** a second click can set an end date (`4 Sep → 10 Sep`). Confirm both date fields show
   the same day before searching; if a range formed, clear and re-pick.
5. **Outbound time floor below the window**: 10 minutes before `departAfter` of the outbound leg. The time sets
   where the result list *starts*, so a floor at or after the train's minute hides it completely. The time
   control is a scrolling list of 96 buttons (`button.btn-item`, `00:00`…`23:45`), not a `<select>`
   (`form_input` does not work): click the input, then click the button with the wanted text.
   Only if clicking by text is not possible: scroll up about 20 ticks to reach `00:00`, scroll
   down about 5.2 items per tick, click.
6. Return time floor: likewise, below the return leg's `departAfter`.
7. **CERCA / SEARCH**.

### 4.2 Outbound: the configured service, then the FREE fare

1. In `VIAGGIO DI ANDATA`, take the train the `status` row named (same number and minute). Without the script:
   the first train of type `service` departing inside the window. Ignore every other service.
2. Expand it with the **chevron**. It auto-selects a paid `BASE` fare: ignore the price grid.
3. **VEDI ALTRE OFFERTE / See other offers**. The panel fills asynchronously and looks empty at first:
   **wait up to 15 seconds** before concluding anything.
4. Set the **Offerta** `select` (via `form_input`, not clicks) to `{leg.offerName}` (option value `{leg.offerId}`).
   The total must flip to **€0.00**; if it does not, stop.
5. In `DATI ACCESSO SCONTI E OFFERTE`: Nome `{traveller.firstName}`, Cognome `{traveller.lastName}`,
   Numero carta tutto treno `{traveller.tuttoTrenoCardNumber}`.
6. Turn **SCEGLI POSTI / Choose seats** ON now (a `SCELTA POSTO` step appears in the breadcrumb); otherwise seats
   are auto-assigned.
7. **VAI AL RITORNO / Go to return journey**. A lapsed entitlement surfaces here (§6): do not retry blindly.

### 4.3 Return: different fare code

1. In `VIAGGIO DI RITORNO`, take the return leg's train; expand, **VEDI ALTRE OFFERTE**, wait.
2. **Offerta** → the return leg's `{leg.offerName}` / `{leg.offerId}`. **Never reuse the outbound code**: the IC
   code on a Frecciabianca is rejected or silently leaves a paid fare.
   **The panel can open on first class**. The free fares exist only under second class: set **Service** to the `2ª CLASSE` entry
   first, then the free fare appears in **Offerta**.
   **The choice can silently not take**: the `select` shows the free fare, but the
   panel keeps `SUPER ECONOMY` at a price, the card fields never appear, and `See price` does not fix it. The
   panel was not ready yet. Select `BASE`, wait 2–3 s, select the free fare again; then the line reads
   `ABBONAMENTI/CTT FB 2° CLASSE 0,00€` and the Name/Surname/card fields appear.
3. Nome and Cognome carry over; the **card number field comes back empty**: type it again.
4. Total **€0.00** → **ACQUISTA / PURCHASE** (this only advances to seat selection; it buys nothing).

### 4.4 Seat selection

Try `seats.knownGood` for the same train number first; with a different number the trainset and floor plan may
differ, so re-derive from `seats.carriages` and `seats.rules` (priority order).

Every seat carries a text label that is more reliable than colours: `Posto a sedere 21B, disponibile`,
`… non disponibile`, `… selezionato` (read it with `read_page` / `find`). Different trains can have different
coach layouts.

The map is one continuous vertical scroll of the whole train; the left sidebar highlights the carriage in view.
**Rows above a `Carrozza N` header belong to carriage N−1**: always read the nearest header *below* the rows.

| Colour | Meaning |
|---|---|
| Teal / green | `Disponibile`, free |
| Light grey | `Occupato`, taken |
| Red | `Selezionato`, your pick |
| Teal 4-seat icon | `Posti frontali con tavolino`, facing seats with a table: avoid |

Seats run 2+2 as `A B | aisle | C D` (A and D are windows). Letters go missing near carriage ends; those gaps
make isolated seats, so look there. Rows with no separator between them face each other; rows against a
separator are back to back (prefer those). Zoom before committing.

Pick the outbound seat → check the right-hand panel shows carriage and seat → **PROSSIMO TRENO** → pick the return
seat → **CONFERMA**.

### 4.5 Final confirmation

`DATI E PAGAMENTO`, with a ~10 minute `Tempo residuo` countdown. Name and CartaFreccia are prefilled; birth date,
phone and email are optional: leave them blank.

1. Tick `Accetto le condizioni di trasporto…` (§0: needs consent or batch authorisation). Until it is ticked,
   **CONFERMA only shows a red warning**. Wait for the green check.
2. Modal *"Non hai indicato dati di contatto per tutti i passeggeri."* → **UTILIZZA I DATI DI CONTATTO
   DELL'ACQUIRENTE**.

Success: **`Acquisto effettuato!`** with `Importo totale 0,00€` (English: `Purchase successful!`,
`Total amount 0,00€`, URL `#/thank-you/<id>`). While it works the page shows `Loading...` for 10–20 s: wait,
do not click again. The page shows no PNR; take it from the trip list (§5). Both legs of one booking share
one PNR.

**First action after success, before navigating anywhere:** append to the run log
(`~/.trenitalia-commute/runs/<YYYY-MM-DD>_bookings.md`): date, both trains, both seats, `€0.00`, and the PNRs, or
`PNR pending verification` when the page does not show them (open the `Riepilogo` card first if it hides them).

### 4.6 Starting the next day

Do **not** click `NUOVA RICERCA` or `GO TO MY JOURNEYS` on the confirmation page: they sit next to Booking.com
and partner banners, and layout shifts redirect clicks into ads. A Booking.com page after a success is not a
failed booking. Navigate directly to the homepage URL, check URL and page heading (a page left on `#/customize`
did not navigate), verify the day (§5), then start the next date.

### 4.7 Recovery after an interruption or timeout

Long offer loads can drop browser control without changing the page. Do not restart the day. Reconnect to the
existing tab, read URL, cart count, total and visible step, and resume from that state. Never start a second
search until the cart and the account state prove it cannot duplicate a leg.

---

## 5. Verify

Run `status` again (or §2.2). Every leg booked in this run must appear exactly once as `booked` with a PNR, with
no duplicates; the cart must be empty at €0.00. A confirmation page is provisional until this proof. Add the PNRs
to the run log.

---

## 6. When the site refuses the booking

### Lapsed entitlement

**Symptom:** the free fare selects, the total shows €0.00, name and card are accepted, then **Vai al ritorno**
answers *"Is not possible to perform the booking for route/date selected"* (Italian: *"Non è possibile
effettuare la prenotazione…"*).

This may be the end of the abbonamento's validity, but one or two failures do not prove it. A past run inferred
expiry from a half-loaded trip list; later scrolling showed valid reservations beyond the supposed boundary.

1. Re-read the full account state (§2) first.
2. Retry a **second, different date** from scratch.
3. If the last booked date and the first failing date are adjacent and two distinct dates fail at the same step,
   expiry is the leading diagnosis. If a nearer date still books, the problem is that date or route: say so.

Then: stop booking from the boundary onward, abandon the cart (empty, €0.00), confirm the trip count is unchanged,
and report the last working date, the first failing date, the exact error, the days still open, and that renewing
the card unblocks them. Renewal and purchases are always the user's own action.

### Other refusals

| What you see | Read it as |
|---|---|
| Every fare priced, none at €0.00 | session expired: §2, sign in, search again |
| Offer panel empty | not loaded yet: wait 15 s |
| No `service` train in the window | timetable change or works: report the day |

---

## 7. Run report

Every run ends with a report, also when it booked nothing. It is how the skill improves.

1. **Booked**: day, leg, train, carriage + seat, PNR.
2. **Skipped**: already booked (with PNR), weekends and holidays, departed.
3. **Blocked**: exact error text, the step, what was tried, the conclusion. Never round a blocked day up to done.
4. **Safety**: nothing paid, no duplicates, cart empty at €0.00, signed in as the configured traveller, no
   password handled.
5. **Drift**: anything that no longer matches this file or the config: retimed or renumbered trains, changed
   labels, moved buttons, new modals, a known-good seat that no longer exists.
6. **Proposed edits**: concrete and quotable, split into *config* changes (personal: times, trains, seats) and
   *skill* changes (procedure, labels, traps). Example: *"config legs[outbound]: update the departure window"*.

Edit the config or this file only when the user asks for it explicitly; a booking request is not that request.

---

## 8. Interface language

The site renders in Italian or English. Match either.

| Italian | English |
|---|---|
| I miei viaggi | My trips / My travels |
| Vai al ritorno | Go to return journey |
| Vedi altre offerte | See other offers |
| Scegli posti | Choose seats |
| Prossimo treno | Next train |
| Conferma / Acquista | Confirm / Buy |
| Tempo residuo | Time remaining |
| Accetto le condizioni di trasporto | I accept the Conditions of Carriage |
| Utilizza i dati di contatto dell'acquirente | Use the purchaser's contact information |
| Acquisto effettuato! | Purchase successful! |
| Prenotazione Abbonamento (trip list) | Subscription Booking |
| Non è possibile effettuare la prenotazione… | Is not possible to perform the booking for route/date selected |

---

## 9. Fault table

| Symptom | Cause | Fix |
|---|---|---|
| Expected train missing from results | time floor at or after its departure | floor 10 min before `departAfter` (§4.1) |
| Dates read as a range (`4 Sep → 10 Sep`) | calendar acted as a range picker | clear, re-pick, check both fields |
| No station autocomplete | full station name typed | delete the last character, wait 2 s |
| Destination went blank | `+ RITORNO` cleared it | refill after toggling |
| Total €9.00 / €12.50 | still on `BASE` | `Vedi altre offerte` → `{leg.offerName}` |
| Fare rejected on the return | outbound code used on the other service | use the return leg's `offerId` |
| Free fare missing from Offerta | Service set to `1ª CLASSE` | set Service to `2ª CLASSE`, then pick the fare |
| Offer panel looks empty | loads asynchronously | wait up to 15 s |
| "Is not possible to perform the booking…" | possibly lapsed entitlement | §6: stop, diagnose, report |
| Every fare priced, none free | signed out or session expired | §2, then search again |
| CONFERMA does nothing | conditions box unticked | tick it, wait for the green check |
| Tick on the conditions box does not stay | page still loading the extras (spinner) | wait 2 s and tick again |
| Free fare missing, Offerta shows only `… 1° classe` fares | offer list not refreshed after the Service change | switch Service away and back to `2ª CLASSE` |
| A day booked twice | stale trip list | `status`, or hard-reload and full scroll (§2.2) |
| Later reservations seem missing | list loaded only its first 10 | `status`, or scroll until the count is stable twice |
| Day looks booked but is not | only one direction reserved | check each leg |
| Landed on Booking.com | clicked near partner banners | open the homepage URL directly |
| Direct navigation seems ignored | page stayed on `#/customize` | check URL and heading, go via the homepage |
| Browser control timed out | long async offer load | reconnect, inspect, resume (§4.7) |
| Wrong carriage reported | read rows above a `Carrozza N` header | those rows belong to carriage N−1 |
| Known-good seat does not exist | different trainset | re-derive from `seats.rules` |
| No seat map step | `SCEGLI POSTI` left off | turn it on before `Vai al ritorno` |
| `status` exit code 2 | not signed in | user runs `commute.mjs login` |
| `status` writes `trips.sample` | trip list format changed | report the file, use §2.2 this run |
