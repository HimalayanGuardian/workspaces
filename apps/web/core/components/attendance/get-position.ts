/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAttendanceCoordinates } from "@/services/attendance.service";
import { ATTENDANCE_STRINGS } from "./constants";

export type TGeolocationFailure = "unsupported" | "denied" | "unavailable" | "timeout";

export class GeolocationError extends Error {
  readonly reason: TGeolocationFailure;

  constructor(reason: TGeolocationFailure, message: string) {
    super(message);
    this.name = "GeolocationError";
    this.reason = reason;
  }
}

const MESSAGES: Record<TGeolocationFailure, string> = {
  unsupported: ATTENDANCE_STRINGS.locationUnsupported,
  denied: ATTENDANCE_STRINGS.locationDenied,
  unavailable: ATTENDANCE_STRINGS.locationUnavailable,
  timeout: ATTENDANCE_STRINGS.locationTimeout,
};

/**
 * Resolve the browser's current position.
 *
 * Call this from inside a click handler, never on mount: the permission prompt
 * needs an obvious cause, and a fix taken at page load is stale by the time
 * anyone presses the button.
 *
 * There is deliberately no fallback. No cached last-known value, no IP-derived
 * guess, no silent zero — if there is no fix there is no check-in, which is the
 * whole point of requiring one.
 */
export const getCurrentPosition = async (): Promise<TAttendanceCoordinates> => {
  // `geolocation` is only present in a secure context, so over plain HTTP on a
  // LAN address this is missing entirely and nobody can check in at all.
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new GeolocationError("unsupported", MESSAGES.unsupported);
  }

  return new Promise<TAttendanceCoordinates>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (error) => {
        const reason: TGeolocationFailure =
          error.code === error.PERMISSION_DENIED ? "denied" : error.code === error.TIMEOUT ? "timeout" : "unavailable";
        reject(new GeolocationError(reason, MESSAGES[reason]));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  });
};
