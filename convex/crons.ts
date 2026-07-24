import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Reminder dispatch. 5 min is the resolution of a reminder's timing — a "2h
// before" reminder lands within 5 minutes of T-2h, which is well inside what
// anyone notices.
crons.interval("send-due-reminders", { minutes: 5 }, internal.reminders.tick, {});

export default crons;
