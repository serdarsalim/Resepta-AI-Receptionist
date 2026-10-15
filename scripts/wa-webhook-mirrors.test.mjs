import { test } from "node:test";
import assert from "node:assert/strict";
import { payloadForMirror, webhookMirrors } from "../convex/lib/waWebhookMirrors.ts";
import { hmacSha256Hex, verifyMetaSignature } from "../convex/lib/metaSig.ts";

const route = { phoneNumberId: "1259016217300193", wabaId: "937571335507091", url: "https://abundant-eel-649.convex.site/whatsapp/cloud-webhook" };
const message = (id) => ({ field: "messages", value: { metadata: { phone_number_id: id }, messages: [{ id: "wamid.test", from: "900000000000" }] } });

test("copies only the configured number and WABA from a mixed Meta batch", () => {
  const event = { object: "whatsapp_business_account", entry: [
    { id: route.wabaId, changes: [message(route.phoneNumberId), message("999")] },
    { id: "another-business", changes: [message(route.phoneNumberId)] },
  ] };
  assert.deepEqual(payloadForMirror(event, route), { object: event.object, entry: [
    { id: route.wabaId, changes: [message(route.phoneNumberId)] },
  ] });
  assert.equal(event.entry[0].changes.length, 2);
});

test("copies shared template review events but drops unrelated fields", () => {
  const template = { field: "message_template_status_update", value: { event: "APPROVED" } };
  assert.deepEqual(payloadForMirror({ object: "whatsapp_business_account", entry: [
    { id: route.wabaId, changes: [template, { field: "account_alerts", value: {} }] },
  ] }, route), { object: "whatsapp_business_account", entry: [{ id: route.wabaId, changes: [template] }] });
});

test("ignores malformed or unrelated payloads", () => {
  for (const payload of [null, {}, { object: "other", entry: [] }, { object: "whatsapp_business_account", entry: [null, { id: route.wabaId, changes: [null] }] }]) {
    assert.equal(payloadForMirror(payload, route), null);
  }
});

test("only permits explicit hosted Nudge receivers without credentials or redirects", () => {
  assert.deepEqual(webhookMirrors(JSON.stringify([route])), [route]);
  assert.deepEqual(webhookMirrors(undefined), []);
  for (const url of ["http://abundant-eel-649.convex.site/whatsapp/cloud-webhook", "https://elsewhere.example/whatsapp/cloud-webhook", route.url + "?token=secret", "https://expert-poodle-803.convex.site/whatsapp/webhook"]) {
    assert.throws(() => webhookMirrors(JSON.stringify([{ ...route, url }])));
  }
});

test("the filtered copy carries a valid signature, while tampering fails", async () => {
  const body = JSON.stringify(payloadForMirror({ object: "whatsapp_business_account", entry: [{ id: route.wabaId, changes: [message(route.phoneNumberId)] }] }, route));
  const signature = `sha256=${await hmacSha256Hex("test-secret", body)}`;
  assert.equal(await verifyMetaSignature("test-secret", body, signature), true);
  assert.equal(await verifyMetaSignature("test-secret", body + " ", signature), false);
});
