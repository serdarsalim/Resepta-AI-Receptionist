"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { DEFAULT_CURRENCY } from "@/lib/money";
import {
  AppointmentModal,
  type ModalDraft,
  type ModalSubmit,
  type SubmitRefusal,
} from "./AppointmentModal";
import type { Rect } from "@/lib/anchoredSheet";

// Everything it takes to put the booking sheet on screen and get an answer out
// of it: the sheet's own state, the org data it renders from, and the
// create/move/update calls behind Save.
//
// A hook rather than three copies of the same wiring. Booking is not one call:
// an edit splits across updateDetails and schedule.move because cal.com has an
// opinion about time and none about notes, a conflict comes back as a refusal
// carrying canForce (the calendar's own verdict since P6, or cal.com's), and
// "book anyway" replays the exact values the owner already typed with force
// set. Two surfaces open this sheet now (the calendar and a contact record)
// and the next one will too. Conflict handling that exists twice is conflict
// handling that will disagree with itself.
//
// It returns a render function instead of props to spread. The caller's job is
// to say WHEN the sheet opens and with what; how it is wired is not a decision
// worth making twice.
export function useBookingSheet({
  onOpenContact,
}: {
  // Opening a customer record replaces the sheet rather than stacking on it.
  // Omitted when the sheet is opened FROM a contact record: there is nowhere
  // to navigate to, so the modal prints the name instead of linking it.
  onOpenContact?: (id: Id<"customers">) => void;
}) {
  const { t } = useLanguage();
  const services = useQuery(api.services.list, {});
  const staff = useQuery(api.staff.list, {});
  const settings = useQuery(api.orgs.current, {});
  const setStatus = useMutation(api.appointments.setStatus);
  // Actions, not mutations: every one of these has to hear back from cal.com
  // before our own row moves. See convex/schedule.ts.
  const createBooking = useAction(api.schedule.create);
  const moveBooking = useAction(api.schedule.move);
  const updateDetails = useMutation(api.appointments.updateDetails);

  const [sheet, setSheet] = useState<ModalDraft | null>(null);
  // What on screen this booking belongs to, when the caller knows. The contact
  // record has nothing to point at, so it simply never passes one.
  const [anchor, setAnchor] = useState<Rect | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const close = () => {
    setSheet(null);
    setAnchor(undefined);
    setError(undefined);
  };

  // Opening always starts from a clean slate. An error left over from the
  // last booking would otherwise greet the next one.
  const open = (draft: ModalDraft, anchorRect?: Rect) => {
    setError(undefined);
    setAnchor(anchorRect);
    setSheet(draft);
  };

  // A refusal a person may overrule goes back to the sheet, which asks "Book
  // it anyway?" and calls this again with force; anything else is an error
  // under the form. The sheet holds the values, so nothing is retyped.
  const refusedOrError = (result: {
    reason?: string;
    canForce?: boolean;
    verdict?: SubmitRefusal["verdict"];
  }): SubmitRefusal | undefined => {
    if (result.canForce) return { verdict: result.verdict, reason: result.reason };
    setError(result.reason ?? t("appointments.moveFailed"));
    return undefined;
  };

  const submit = async (
    values: ModalSubmit,
    force: boolean,
  ): Promise<SubmitRefusal | undefined> => {
    if (!sheet) return undefined;
    setPending(true);
    setError(undefined);
    try {
      if (sheet.appointmentId) {
        const timeChanged =
          values.startAt !== sheet.startAt ||
          values.durationMinutes !== sheet.durationMinutes;
        if (timeChanged) {
          // Time and length have to be agreed with cal.com first, so they
          // ride schedule.move, and the team member goes with them: the
          // calendar judges the person at the NEW time (P6). Moved first, so
          // a move the calendar refuses saves nothing until the person
          // answers.
          const result = await moveBooking({
            appointmentId: sheet.appointmentId,
            startAt: values.startAt,
            durationMinutes: values.durationMinutes,
            staffId: values.staffId ?? null,
            force,
          });
          if (!result.ok) return refusedOrError(result);
          // Details cal.com has no opinion about go straight in.
          await updateDetails({
            appointmentId: sheet.appointmentId,
            lines: values.lines,
            notes: values.notes,
          });
        } else {
          // The time stands, so a new team member is the one new fact: the
          // calendar judges only their own clash (appointments.updateDetails).
          const result = await updateDetails({
            appointmentId: sheet.appointmentId,
            lines: values.lines,
            staffId: values.staffId ?? null,
            notes: values.notes,
            force,
          });
          if (!result.ok) return { verdict: result.verdict };
        }
      } else {
        const result = await createBooking({
          customerId: values.customerId,
          newCustomer: values.newCustomer,
          lines: values.lines,
          staffId: values.staffId ?? undefined,
          startAt: values.startAt,
          durationMinutes: values.durationMinutes,
          notes: values.notes,
          force,
        });
        if (!result.ok) return refusedOrError(result);
      }
      close();
      return undefined;
    } finally {
      setPending(false);
    }
  };

  // `tabs` is the Appointment | Blocked-time row, passed by the calendar and
  // shown on NEW drafts only: an existing booking is not half of a choice, and
  // the contact record simply calls render() bare — it has no grid to draw
  // blocks on. An argument rather than a hook input so the caller can build it
  // from things (the block sheet's open/close) that live beside this hook.
  // `grid` is the rest of what only the calendar has: the height floor the
  // two kinds share, and the band that follows the sheet's time.
  const render = (
    tabs?: React.ReactNode,
    grid?: {
      heightFloor?: number;
      onNaturalHeight?: (px: number) => void;
      onSlotChange?: (startAt: number, durationMinutes: number, staffId?: string) => void;
    },
  ) =>
    sheet ? (
      <AppointmentModal
        draft={sheet}
        services={(services ?? []).filter((service) => service.active)}
        currency={settings?.org.currency ?? DEFAULT_CURRENCY}
        priceDecimals={settings?.org.priceDecimals}
        staff={staff ?? []}
        staffLabel={t("appointments.staff")}
        pending={pending}
        error={error}
        minNoticeHours={settings?.org.minNoticeHours ?? 0}
        onClose={close}
        onOpenCustomer={
          onOpenContact
            ? (id) => {
                close();
                onOpenContact(id);
              }
            : undefined
        }
        onDelete={
          sheet.appointmentId
            ? () => {
                const id = sheet.appointmentId;
                if (!id) return;
                void setStatus({ appointmentId: id, status: "cancelled" });
                close();
              }
            : undefined
        }
        anchor={anchor}
        tabs={sheet.appointmentId ? undefined : tabs}
        heightFloor={sheet.appointmentId ? undefined : grid?.heightFloor}
        onNaturalHeight={sheet.appointmentId ? undefined : grid?.onNaturalHeight}
        onSlotChange={sheet.appointmentId ? undefined : grid?.onSlotChange}
        onSubmit={submit}
      />
    ) : null;

  return { open, close, render, isOpen: sheet !== null, anchor };
}
