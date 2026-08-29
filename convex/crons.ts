import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Reminder dispatch. 5 min is the resolution of a reminder's timing — a "2h
// before" reminder lands within 5 minutes of T-2h, which is well inside what
// anyone notices. The tick reads an index of what is DUE, so its cost tracks
// the work rather than the number of orgs on the deployment.
crons.interval("send-due-reminders", { minutes: 5 }, internal.reminders.tick, {});

// Repairs appointments whose stored due time drifted from what their row and
// org settings actually imply. Nothing should produce drift — every write path
// calls syncAppointmentSchedule — so this finding work means a write path was
// added without one, and the customer still gets their reminder while we go
// find it. Hourly is plenty: it only has to beat the earliest offset a salon
// can configure, and it scans a 48-hour window of live bookings.
crons.interval("reconcile-reminder-schedule", { hours: 1 }, internal.reminders.reconcile, {});

// Yesterday's bookings are done. Hourly rather than daily because orgs sit in
// different timezones and "the day is over" happens at a different UTC moment
// for each of them; the mutation decides per org and does nothing the rest of
// the time.
crons.interval("complete-past", { hours: 1 }, internal.appointments.completePast, {});

// Parked WhatsApp messages. One minute rather than five: a person picked this
// time deliberately, and "in five minutes, roughly" is not what they asked
// for. The claim-then-send ordering inside makes overlapping ticks harmless.
crons.interval("send-scheduled-messages", { minutes: 1 }, internal.wa.sendDueScheduled, {});

// Sends the provider refused for a reason that might not hold later — a 500, a
// rate limit, a dropped connection. Every minute because the first backoff
// step is one minute and a reminder that recovers is only useful if it
// recovers before the appointment.
crons.interval("retry-failed-sends", { minutes: 1 }, internal.delivery.retryDue, {});

// Rows claimed for sending whose action never came back. Ten minutes is far
// more often than the two-hour threshold needs, and it costs one indexed read
// that returns nothing on a healthy deployment.
crons.interval("reap-stuck-sends", { minutes: 10 }, internal.delivery.reapStuck, {});

// The bulk call queue's safety net, and this deployment's first voice cron.
//
// The queue is driven by the call_ended webhook, so on a healthy run this does
// nothing at all. It exists for the two ways the chain can break with nobody
// watching: a webhook Retell never delivered, which leaves one item "dialing"
// forever, and a deploy that killed the single scheduled action mid-chain,
// which leaves a run with nothing in flight and pending items it will never
// reach. Both look identical to the owner — a progress bar that stopped — and
// neither produces an error anywhere.
//
// Five minutes against a twenty-minute stuck threshold, so a genuinely long
// call is never cut off by it. One indexed read that returns nothing on a
// deployment with no live runs.
crons.interval("reap-stuck-bulk-calls", { minutes: 5 }, internal.bulkRuns.reapStuckCalls, {});

// The showroom is a shared surface: whatever the last visitor did is what the
// next one sees. Rebuilt from a fixed dataset overnight rather than asking
// anyone to be careful with it. 02:00 UTC is the quiet hour for a Türkiye-first
// product, and a no-op on any deployment with no demo org.
crons.cron("reset-demo-org", "0 2 * * *", internal.demo.nightlyReset, {});

export default crons;
