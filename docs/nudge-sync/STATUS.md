# Nudge → Resepta sync: status

**Needs you:** Nothing.

**New since last time:**
- The voice agent's Publish makes one version with a note saying what changed, and the version number opens the agent's history; Restore puts an older version's words back in the editor.
- A voicemail choice on the agent page: hang up, leave exact words, leave a message from instructions, or don't detect it.
- Test calls and bulk calls always speak with the published version, never a half-finished edit.
- Test an agent in the browser: talk to it as one of your customers or a new caller, see what it would have booked or saved, the summary, recording and transcript. Nothing real happens; the minutes are billed like a call.
- Try the WhatsApp assistant from the agents table: write as a customer, see its reply and what it would book. Nothing is sent.
- WhatsApp messages show bold, italic and strike; the thread looks like WhatsApp (plain paper, tails, spacing); a failed send says why ("not on WhatsApp", "window closed").
- Call cards say who placed the call, what it booked, and the player shows the length before loading.
- A customer record has its own link (cmd-click opens it in a new tab), its name in the browser tab, a copy button on the phone, notes as signed rows, Tab moving through fields, searchable picklists.

**Ready to look at:** Voice agent page: edit, Publish, open the version number, Restore, the voicemail row, Test in the browser. Agents table: Try the WhatsApp assistant. A customer's WhatsApp thread, calls tab and notes tab. Admin templates table's category column.

**Before shipping:** Deploy Convex first (new tables agentTests; new optional fields on retellAgents, calls, waTemplates, usageMonthly). Subscribe the Meta app to template_category_update. Check on one real call that inbound answers with the published version.

**Up next:** The rest of P12 (read-only cards for team members), then P13 inbox paging.
