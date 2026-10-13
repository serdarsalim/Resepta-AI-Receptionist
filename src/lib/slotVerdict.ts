// The calendar's verdict on a slot, in words (schedule.slotVerdict, P6 of the
// Nudge port). One wording for the booking sheet's line, its "Book it anyway?"
// question and the dialog a refused drag opens, so the three never disagree.

import type { Translator } from "./i18n";
// Type only: the module itself imports convex/values, which has no business
// in the bundle for a type.
import type { SlotVerdict } from "../../convex/lib/slotVerdict";

export type { SlotVerdict };

// The conflict as a sentence, naming the customer or the team member it is
// about when the caller knows them. null when there is no conflict.
export function conflictText(
  t: Translator,
  verdict: SlotVerdict | undefined,
  names: { customer?: string; staff?: string },
): string | null {
  switch (verdict?.conflict) {
    case "outside-hours":
      return t("appointments.slotOutsideHours");
    case "closed":
      return verdict.closedReason
        ? t("appointments.slotClosedReason", { reason: verdict.closedReason })
        : t("appointments.slotClosed");
    case "customer-busy":
      return names.customer
        ? t("appointments.slotCustomerBusy", { name: names.customer })
        : t("appointments.slotCustomerBusyAnon");
    case "staff-busy":
      return names.staff
        ? t("appointments.slotStaffBusy", { name: names.staff })
        : t("appointments.slotStaffBusyAnon");
    case "full":
      return t("appointments.slotFull");
    default:
      return null;
  }
}
