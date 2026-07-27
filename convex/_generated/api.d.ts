/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as appointments from "../appointments.js";
import type * as auth from "../auth.js";
import type * as calcom from "../calcom.js";
import type * as campaigns from "../campaigns.js";
import type * as connections from "../connections.js";
import type * as contactFields from "../contactFields.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as delivery from "../delivery.js";
import type * as demo from "../demo.js";
import type * as devSeed from "../devSeed.js";
import type * as email from "../email.js";
import type * as evolution from "../evolution.js";
import type * as forms from "../forms.js";
import type * as http from "../http.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_alerts from "../lib/alerts.js";
import type * as lib_awayReply from "../lib/awayReply.js";
import type * as lib_businessHours from "../lib/businessHours.js";
import type * as lib_calcomApi from "../lib/calcomApi.js";
import type * as lib_connections from "../lib/connections.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_emailInbound from "../lib/emailInbound.js";
import type * as lib_evolution from "../lib/evolution.js";
import type * as lib_format from "../lib/format.js";
import type * as lib_keys from "../lib/keys.js";
import type * as lib_metaSig from "../lib/metaSig.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_newCustomer from "../lib/newCustomer.js";
import type * as lib_orgAuth from "../lib/orgAuth.js";
import type * as lib_platformAuth from "../lib/platformAuth.js";
import type * as lib_reminderSchedule from "../lib/reminderSchedule.js";
import type * as lib_renderTokens from "../lib/renderTokens.js";
import type * as lib_sendFailure from "../lib/sendFailure.js";
import type * as lib_waCloud from "../lib/waCloud.js";
import type * as lib_waLane from "../lib/waLane.js";
import type * as media from "../media.js";
import type * as messages from "../messages.js";
import type * as notes from "../notes.js";
import type * as orgs from "../orgs.js";
import type * as platform from "../platform.js";
import type * as reminders from "../reminders.js";
import type * as reports from "../reports.js";
import type * as retell from "../retell.js";
import type * as schedule from "../schedule.js";
import type * as services from "../services.js";
import type * as staff from "../staff.js";
import type * as team from "../team.js";
import type * as users from "../users.js";
import type * as wa from "../wa.js";
import type * as webhook from "../webhook.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  appointments: typeof appointments;
  auth: typeof auth;
  calcom: typeof calcom;
  campaigns: typeof campaigns;
  connections: typeof connections;
  contactFields: typeof contactFields;
  crons: typeof crons;
  customers: typeof customers;
  delivery: typeof delivery;
  demo: typeof demo;
  devSeed: typeof devSeed;
  email: typeof email;
  evolution: typeof evolution;
  forms: typeof forms;
  http: typeof http;
  "lib/activity": typeof lib_activity;
  "lib/alerts": typeof lib_alerts;
  "lib/awayReply": typeof lib_awayReply;
  "lib/businessHours": typeof lib_businessHours;
  "lib/calcomApi": typeof lib_calcomApi;
  "lib/connections": typeof lib_connections;
  "lib/email": typeof lib_email;
  "lib/emailInbound": typeof lib_emailInbound;
  "lib/evolution": typeof lib_evolution;
  "lib/format": typeof lib_format;
  "lib/keys": typeof lib_keys;
  "lib/metaSig": typeof lib_metaSig;
  "lib/money": typeof lib_money;
  "lib/newCustomer": typeof lib_newCustomer;
  "lib/orgAuth": typeof lib_orgAuth;
  "lib/platformAuth": typeof lib_platformAuth;
  "lib/reminderSchedule": typeof lib_reminderSchedule;
  "lib/renderTokens": typeof lib_renderTokens;
  "lib/sendFailure": typeof lib_sendFailure;
  "lib/waCloud": typeof lib_waCloud;
  "lib/waLane": typeof lib_waLane;
  media: typeof media;
  messages: typeof messages;
  notes: typeof notes;
  orgs: typeof orgs;
  platform: typeof platform;
  reminders: typeof reminders;
  reports: typeof reports;
  retell: typeof retell;
  schedule: typeof schedule;
  services: typeof services;
  staff: typeof staff;
  team: typeof team;
  users: typeof users;
  wa: typeof wa;
  webhook: typeof webhook;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
