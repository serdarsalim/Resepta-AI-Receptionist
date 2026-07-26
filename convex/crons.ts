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

export default crons;
