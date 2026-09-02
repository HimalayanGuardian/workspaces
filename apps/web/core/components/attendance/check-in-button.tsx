/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { LoaderCircle, LogIn, LogOut, TriangleAlert } from "lucide-react";
import useSWR from "swr";
// plane imports
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
// components
import { AppSidebarItem } from "@/components/sidebar/sidebar-item";
// services
import attendanceService, {
  type TAttendanceCoordinates,
  type TAttendanceError,
  type TAttendanceStatus,
} from "@/services/attendance.service";
// local imports
import { ATTENDANCE_STRINGS } from "./constants";
import { GeolocationError, getCurrentPosition } from "./get-position";

const ATTENDANCE_STATUS_KEY = "ATTENDANCE_STATUS";

/** `2026-09-01T03:15:00Z` in the employee's own zone, as `9:00 AM`. */
const formatTime = (iso: string, timeZone?: string): string => {
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone }).format(new Date(iso));
  } catch {
    // An unrecognised zone from the payload must not take the navbar down.
    return new Intl.DateTimeFormat(undefined, options).format(new Date(iso));
  }
};

/** Odoo's fractional hours (`5.1`) as `5h 06m`. */
const formatHours = (hours: number): string => {
  const minutes = Math.max(0, Math.round(hours * 60));
  const wholeHours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return wholeHours > 0 ? `${wholeHours}h ${String(remainder).padStart(2, "0")}m` : `${remainder}m`;
};

export const AttendanceCheckInButton = observer(function AttendanceCheckInButton() {
  // states
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    data: status,
    error,
    isLoading,
    mutate,
  } = useSWR<TAttendanceStatus, TAttendanceError>(ATTENDANCE_STATUS_KEY, () => attendanceService.getStatus(), {
    // A 503 means Odoo is unreachable; retrying on a timer would just queue up
    // more requests against something already known to be down.
    shouldRetryOnError: false,
  });

  const isNotLinked = error?.code === "not_linked";

  // Nothing while the first read is in flight, and nothing when attendance is
  // switched off or unreachable: an attendance outage must never be visible in
  // the rest of the workspace.
  if (isLoading) return null;
  if (!isNotLinked && (error || !status?.available)) return null;

  const isCheckedIn = Boolean(status?.checked_in);
  const isBusy = isLocating || isSubmitting;

  const handleClick = async () => {
    // Guards the double-click, and the ten seconds a location fix can take.
    if (isBusy) return;

    // A provisioning defect, not an empty state. Say what the fix is rather
    // than doing nothing quietly.
    if (isNotLinked) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: ATTENDANCE_STRINGS.notLinkedTitle,
        message: error?.error ?? "",
      });
      return;
    }

    try {
      let next: TAttendanceStatus;

      if (isCheckedIn) {
        // Best effort on the way out: blocking a check-out on a permission
        // prompt would strand an open session with Odoo still counting hours.
        const coordinates = await getCurrentPosition().catch(() => undefined);
        setIsSubmitting(true);
        next = await attendanceService.checkOut(coordinates);
      } else {
        setIsLocating(true);
        let coordinates: TAttendanceCoordinates;
        try {
          coordinates = await getCurrentPosition();
        } finally {
          setIsLocating(false);
        }
        setIsSubmitting(true);
        next = await attendanceService.checkIn(coordinates);
      }

      // The write returns the status after it, so there is no follow-up read.
      await mutate(next, { revalidate: false });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: isCheckedIn ? ATTENDANCE_STRINGS.checkedOutToast : ATTENDANCE_STRINGS.checkedInToast,
      });
    } catch (submitError) {
      if (submitError instanceof GeolocationError) {
        setToast({ type: TOAST_TYPE.ERROR, title: ATTENDANCE_STRINGS.failedTitle, message: submitError.message });
        return;
      }

      const failure = submitError as TAttendanceError | undefined;

      // Two tabs can race, so a conflict is an ordinary outcome: re-read the
      // truth from Odoo rather than showing the user something alarming.
      if (failure?.code === "already_checked_in" || failure?.code === "not_checked_in") {
        await mutate();
        return;
      }

      setToast({
        type: TOAST_TYPE.ERROR,
        title: ATTENDANCE_STRINGS.failedTitle,
        message: failure?.error ?? (isCheckedIn ? ATTENDANCE_STRINGS.checkOutFailed : ATTENDANCE_STRINGS.checkInFailed),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const tooltipLabel = (() => {
    if (isNotLinked) return ATTENDANCE_STRINGS.notLinked(status?.employee?.work_email ?? "your account");
    if (isLocating) return ATTENDANCE_STRINGS.locating;
    if (!isCheckedIn) return ATTENDANCE_STRINGS.checkIn;

    // Checked in: the tooltip carries the detail the icon cannot.
    const parts: string[] = [ATTENDANCE_STRINGS.checkOut];
    if (status?.check_in) parts.push(ATTENDANCE_STRINGS.checkedInAt(formatTime(status.check_in, status.timezone)));
    if (typeof status?.worked_hours_today === "number") {
      parts.push(ATTENDANCE_STRINGS.todayTotal(formatHours(status.worked_hours_today)));
    }
    return parts.join(" · ");
  })();

  const Icon = isNotLinked ? TriangleAlert : isCheckedIn ? LogOut : LogIn;

  return (
    <Tooltip label={tooltipLabel} side="bottom">
      <AppSidebarItem
        variant="button"
        item={{
          icon: (
            <div className="relative">
              {isBusy ? <LoaderCircle className="size-5 animate-spin" /> : <Icon className="size-5" />}
              {isCheckedIn && !isBusy && (
                <span className="absolute top-0 right-0 size-2 rounded-full bg-success-primary" />
              )}
            </div>
          ),
          onClick: handleClick,
          disabled: isBusy,
        }}
      />
    </Tooltip>
  );
});
