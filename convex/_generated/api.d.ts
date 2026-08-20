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
import type * as agentReports from "../agentReports.js";
import type * as agentTools from "../agentTools.js";
import type * as appointments from "../appointments.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as booking from "../booking.js";
import type * as calcom from "../calcom.js";
import type * as calls from "../calls.js";
import type * as campaigns from "../campaigns.js";
import type * as chatAgent from "../chatAgent.js";
import type * as connections from "../connections.js";
import type * as contactFields from "../contactFields.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as delivery from "../delivery.js";
import type * as demo from "../demo.js";
import type * as devSeed from "../devSeed.js";
import type * as email from "../email.js";
import type * as evolution from "../evolution.js";
import type * as http from "../http.js";
import type * as knowledge from "../knowledge.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_alerts from "../lib/alerts.js";
import type * as lib_awayReply from "../lib/awayReply.js";
import type * as lib_bookingLimits from "../lib/bookingLimits.js";
import type * as lib_businessHours from "../lib/businessHours.js";
import type * as lib_calcomApi from "../lib/calcomApi.js";
import type * as lib_chatAgentTemplate from "../lib/chatAgentTemplate.js";
import type * as lib_chatLlm from "../lib/chatLlm.js";
import type * as lib_connections from "../lib/connections.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_emailInbound from "../lib/emailInbound.js";
import type * as lib_emailQuote from "../lib/emailQuote.js";
import type * as lib_evolution from "../lib/evolution.js";
import type * as lib_format from "../lib/format.js";
import type * as lib_ics from "../lib/ics.js";
import type * as lib_inboundAddress from "../lib/inboundAddress.js";
import type * as lib_industryPresets from "../lib/industryPresets.js";
import type * as lib_keys from "../lib/keys.js";
import type * as lib_llm from "../lib/llm.js";
import type * as lib_mcpProtocol from "../lib/mcpProtocol.js";
import type * as lib_metaSig from "../lib/metaSig.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_newCustomer from "../lib/newCustomer.js";
import type * as lib_noteBody from "../lib/noteBody.js";
import type * as lib_orgAuth from "../lib/orgAuth.js";
import type * as lib_overlap from "../lib/overlap.js";
import type * as lib_phone from "../lib/phone.js";
import type * as lib_planToken from "../lib/planToken.js";
import type * as lib_platformAuth from "../lib/platformAuth.js";
import type * as lib_platformConfig from "../lib/platformConfig.js";
import type * as lib_publicPhone from "../lib/publicPhone.js";
import type * as lib_publicSlug from "../lib/publicSlug.js";
import type * as lib_reminderSchedule from "../lib/reminderSchedule.js";
import type * as lib_renderTokens from "../lib/renderTokens.js";
import type * as lib_sendFailure from "../lib/sendFailure.js";
import type * as lib_speech from "../lib/speech.js";
import type * as lib_templateTexts from "../lib/templateTexts.js";
import type * as lib_usage from "../lib/usage.js";
import type * as lib_voiceAgentTemplate from "../lib/voiceAgentTemplate.js";
import type * as lib_voiceCatalogue from "../lib/voiceCatalogue.js";
import type * as lib_voiceModels from "../lib/voiceModels.js";
import type * as lib_voicePayload from "../lib/voicePayload.js";
import type * as lib_voiceRuntime from "../lib/voiceRuntime.js";
import type * as lib_voiceVariables from "../lib/voiceVariables.js";
import type * as lib_waCloud from "../lib/waCloud.js";
import type * as lib_waLane from "../lib/waLane.js";
import type * as mcp from "../mcp.js";
import type * as mcpKeys from "../mcpKeys.js";
import type * as media from "../media.js";
import type * as messageRules from "../messageRules.js";
import type * as messages from "../messages.js";
import type * as notes from "../notes.js";
import type * as onboarding from "../onboarding.js";
import type * as orgs from "../orgs.js";
import type * as platform from "../platform.js";
import type * as platformConfig from "../platformConfig.js";
import type * as reminders from "../reminders.js";
import type * as reports from "../reports.js";
import type * as retell from "../retell.js";
import type * as retellAgent from "../retellAgent.js";
import type * as schedule from "../schedule.js";
import type * as services from "../services.js";
import type * as staff from "../staff.js";
import type * as team from "../team.js";
import type * as users from "../users.js";
import type * as voiceBackfill from "../voiceBackfill.js";
import type * as voiceEvents from "../voiceEvents.js";
import type * as voiceMcp from "../voiceMcp.js";
import type * as voiceProvisioning from "../voiceProvisioning.js";
import type * as wa from "../wa.js";
import type * as wallet from "../wallet.js";
import type * as webhook from "../webhook.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  agentReports: typeof agentReports;
  agentTools: typeof agentTools;
  appointments: typeof appointments;
  auth: typeof auth;
  billing: typeof billing;
  booking: typeof booking;
  calcom: typeof calcom;
  calls: typeof calls;
  campaigns: typeof campaigns;
  chatAgent: typeof chatAgent;
  connections: typeof connections;
  contactFields: typeof contactFields;
  crons: typeof crons;
  customers: typeof customers;
  delivery: typeof delivery;
  demo: typeof demo;
  devSeed: typeof devSeed;
  email: typeof email;
  evolution: typeof evolution;
  http: typeof http;
  knowledge: typeof knowledge;
  "lib/activity": typeof lib_activity;
  "lib/alerts": typeof lib_alerts;
  "lib/awayReply": typeof lib_awayReply;
  "lib/bookingLimits": typeof lib_bookingLimits;
  "lib/businessHours": typeof lib_businessHours;
  "lib/calcomApi": typeof lib_calcomApi;
  "lib/chatAgentTemplate": typeof lib_chatAgentTemplate;
  "lib/chatLlm": typeof lib_chatLlm;
  "lib/connections": typeof lib_connections;
  "lib/email": typeof lib_email;
  "lib/emailInbound": typeof lib_emailInbound;
  "lib/emailQuote": typeof lib_emailQuote;
  "lib/evolution": typeof lib_evolution;
  "lib/format": typeof lib_format;
  "lib/ics": typeof lib_ics;
  "lib/inboundAddress": typeof lib_inboundAddress;
  "lib/industryPresets": typeof lib_industryPresets;
  "lib/keys": typeof lib_keys;
  "lib/llm": typeof lib_llm;
  "lib/mcpProtocol": typeof lib_mcpProtocol;
  "lib/metaSig": typeof lib_metaSig;
  "lib/money": typeof lib_money;
  "lib/newCustomer": typeof lib_newCustomer;
  "lib/noteBody": typeof lib_noteBody;
  "lib/orgAuth": typeof lib_orgAuth;
  "lib/overlap": typeof lib_overlap;
  "lib/phone": typeof lib_phone;
  "lib/planToken": typeof lib_planToken;
  "lib/platformAuth": typeof lib_platformAuth;
  "lib/platformConfig": typeof lib_platformConfig;
  "lib/publicPhone": typeof lib_publicPhone;
  "lib/publicSlug": typeof lib_publicSlug;
  "lib/reminderSchedule": typeof lib_reminderSchedule;
  "lib/renderTokens": typeof lib_renderTokens;
  "lib/sendFailure": typeof lib_sendFailure;
  "lib/speech": typeof lib_speech;
  "lib/templateTexts": typeof lib_templateTexts;
  "lib/usage": typeof lib_usage;
  "lib/voiceAgentTemplate": typeof lib_voiceAgentTemplate;
  "lib/voiceCatalogue": typeof lib_voiceCatalogue;
  "lib/voiceModels": typeof lib_voiceModels;
  "lib/voicePayload": typeof lib_voicePayload;
  "lib/voiceRuntime": typeof lib_voiceRuntime;
  "lib/voiceVariables": typeof lib_voiceVariables;
  "lib/waCloud": typeof lib_waCloud;
  "lib/waLane": typeof lib_waLane;
  mcp: typeof mcp;
  mcpKeys: typeof mcpKeys;
  media: typeof media;
  messageRules: typeof messageRules;
  messages: typeof messages;
  notes: typeof notes;
  onboarding: typeof onboarding;
  orgs: typeof orgs;
  platform: typeof platform;
  platformConfig: typeof platformConfig;
  reminders: typeof reminders;
  reports: typeof reports;
  retell: typeof retell;
  retellAgent: typeof retellAgent;
  schedule: typeof schedule;
  services: typeof services;
  staff: typeof staff;
  team: typeof team;
  users: typeof users;
  voiceBackfill: typeof voiceBackfill;
  voiceEvents: typeof voiceEvents;
  voiceMcp: typeof voiceMcp;
  voiceProvisioning: typeof voiceProvisioning;
  wa: typeof wa;
  wallet: typeof wallet;
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
