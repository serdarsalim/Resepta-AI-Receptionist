/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appointments from "../appointments.js";
import type * as auth from "../auth.js";
import type * as calcom from "../calcom.js";
import type * as contactFields from "../contactFields.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as devSeed from "../devSeed.js";
import type * as http from "../http.js";
import type * as lib_alerts from "../lib/alerts.js";
import type * as lib_businessHours from "../lib/businessHours.js";
import type * as lib_calcomApi from "../lib/calcomApi.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_format from "../lib/format.js";
import type * as lib_metaSig from "../lib/metaSig.js";
import type * as lib_orgAuth from "../lib/orgAuth.js";
import type * as lib_waCloud from "../lib/waCloud.js";
import type * as messages from "../messages.js";
import type * as migrations from "../migrations.js";
import type * as orgs from "../orgs.js";
import type * as reminders from "../reminders.js";
import type * as retell from "../retell.js";
import type * as services from "../services.js";
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
  appointments: typeof appointments;
  auth: typeof auth;
  calcom: typeof calcom;
  contactFields: typeof contactFields;
  crons: typeof crons;
  customers: typeof customers;
  devSeed: typeof devSeed;
  http: typeof http;
  "lib/alerts": typeof lib_alerts;
  "lib/businessHours": typeof lib_businessHours;
  "lib/calcomApi": typeof lib_calcomApi;
  "lib/email": typeof lib_email;
  "lib/format": typeof lib_format;
  "lib/metaSig": typeof lib_metaSig;
  "lib/orgAuth": typeof lib_orgAuth;
  "lib/waCloud": typeof lib_waCloud;
  messages: typeof messages;
  migrations: typeof migrations;
  orgs: typeof orgs;
  reminders: typeof reminders;
  retell: typeof retell;
  services: typeof services;
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
