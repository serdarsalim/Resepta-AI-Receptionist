import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Reminder dispatch. 5 min is the resolution of a reminder's timing — a "2h
// before" reminder lands within 5 minutes of T-2h, which is well inside what
// anyone notices.
crons.interval("send-due-reminders", { minutes: 5 }, internal.reminders.tick, {});

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
