"use client";

import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { AppointmentModal, type ModalDraft, type ModalSubmit } from "./AppointmentModal";
import type { Rect } from "@/lib/anchoredSheet";

// Everything it takes to put the booking sheet on screen and get an answer out
// of it: the sheet's own state, the org data it renders from, and the
// create/move/update calls behind Save.
//
// A hook rather than three copies of the same wiring. Booking is not one call:
// an edit splits across updateDetails and schedule.move because cal.com has an
// opinion about time and none about notes, a conflict comes back as a refusal
// carrying canForce, and "book anyway" has to replay the exact values the owner
// already typed. Two surfaces open this sheet now (the calendar and a contact
// record) and the next one will too. Conflict handling that exists twice is
// conflict handling that will disagree with itself.
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
  const [canForce, setCanForce] = useState(false);
  const [pending, setPending] = useState(false);

  // Held so "book anyway" can replay the exact same values with force set,
  // rather than asking the owner to retype anything.
  const lastSubmit = useRef<ModalSubmit | null>(null);

  const close = () => {
    setSheet(null);
    setAnchor(undefined);
    setError(undefined);
    setCanForce(false);
  };

  // Opening always starts from a clean slate. A conflict left over from the
  // last booking would otherwise greet the next one.
  const open = (draft: ModalDraft, anchorRect?: Rect) => {
    setError(undefined);
    setCanForce(false);
    setAnchor(anchorRect);
    setSheet(draft);
  };

  const submit = async (values: ModalSubmit | null, force: boolean) => {
    if (!values || !sheet) return;
    lastSubmit.current = values;
    setPending(true);
    setError(undefined);
    try {
      if (sheet.appointmentId) {
        // Details cal.com has no opinion about go straight in; time and length
        // have to be agreed with cal.com first, so they ride schedule.move.
        await updateDetails({
          appointmentId: sheet.appointmentId,
          lines: values.lines,
          staffId: values.staffId ?? null,
          notes: values.notes,
        });
        const timeChanged =
          values.startAt !== sheet.startAt ||
          values.durationMinutes !== sheet.durationMinutes;
        if (timeChanged) {
          const result = await moveBooking({
            appointmentId: sheet.appointmentId,
            startAt: values.startAt,
            durationMinutes: values.durationMinutes,
            force,
          });
          if (!result.ok) {
            setError(result.reason ?? t("appointments.moveFailed"));
            setCanForce(Boolean(result.canForce));
            return;
          }
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
        if (!result.ok) {
          setError(result.reason ?? t("appointments.moveFailed"));
          setCanForce(Boolean(result.canForce));
          return;
        }
      }
      close();
    } finally {
      setPending(false);
    }
  };

  const render = () =>
    sheet ? (
      <AppointmentModal
        draft={sheet}
        services={(services ?? []).filter((service) => service.active)}
        currency={settings?.org.currency ?? DEFAULT_CURRENCY}
        staff={staff ?? []}
        staffLabel={t("appointments.staff")}
        pending={pending}
        error={error}
        canForce={canForce}
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
        onSubmit={(values) => void submit(values, false)}
        onForce={() => void submit(lastSubmit.current, true)}
      />
    ) : null;

  return { open, close, render, isOpen: sheet !== null, anchor };
}
