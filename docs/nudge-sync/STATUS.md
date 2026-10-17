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
- Team members see read-only cards as plain values instead of a dimmed form.
- The Inbox scrolls through every conversation (no more 700 cap), with counts and search done on the server; a pin stays until you unpin it; email sent as HTML previews as words.
- Searching for a customer (header search, booking sheet) finds anyone, not only the newest 1,000; the Customers table loads up to 5,000.
- A bulk run's page says who booked and who replied after it; tap a count to see just them, and Follow up sends those people a new message or call.
- Paste a screenshot into the WhatsApp message box, or drop a file on the conversation, and it attaches; big phone photos shrink to fit; PowerPoint and text files can be sent; a file uploaded twice is kept once; files can be deleted from the library.
- Variables in message and email boxes read as chips in your language ("İşletme adı" instead of [business]); typing @ offers the list; first name is in the list now.
- You stay signed in when the browser restarts.
- Dropdown lists stand off the card in dark mode; the country code picker is typed into its own box and shows five rows.
- Business has an Address row: it shows as the location on calendar invites, and [address] puts it in a message.

**Ready to look at:** Voice agent page: edit, Publish, open the version number, Restore, the voicemail row, Test in the browser. Agents table: Try the WhatsApp assistant. A customer's WhatsApp thread, calls tab and notes tab. Admin templates table's category column. The Inbox: scroll far, Unread and Pinned counts, search. The booking sheet's customer picker. A past bulk run's page. Pasting and dropping a file into a WhatsApp conversation. A message rule's text and email body, a campaign, a bulk message: type @. Business → Address, then a confirmation email's invite. Dark mode: any dropdown. A phone field's country code: type +90.

**Before shipping:** Deploy Convex first (new tables agentTests; new optional fields on retellAgents, calls, waTemplates, usageMonthly). Subscribe the Meta app to template_category_update. Check on one real call that inbound answers with the published version. After the deploy run `customers:backfillSearch` and `threads:backfill`, or search finds nobody.

**Up next:** P20 hover labels, then P21 onward.
