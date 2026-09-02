/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// api services
import { APIService } from "@/services/api.service";

export type TAttendanceCoordinates = {
  latitude: number;
  longitude: number;
};

export type TAttendanceSession = {
  check_in: string | null;
  check_out: string | null;
  worked_hours: number;
};

/**
 * Today's attendance for the signed-in user, as Odoo holds it.
 *
 * Timestamps are UTC with an explicit `Z`; `timezone` is the *employee's* zone
 * and is what they should be displayed in. `worked_hours_today` already
 * includes the running session.
 *
 * Everything past `available` is absent when the feature is switched off, so
 * check that flag before reading the rest.
 */
export type TAttendanceStatus = {
  available: boolean;
  employee?: {
    id: number;
    name: string;
    work_email: string;
    department: string | null;
  };
  date?: string;
  timezone?: string;
  checked_in?: boolean;
  check_in?: string | null;
  current_session_hours?: number;
  worked_hours_today?: number;
  closed_hours_today?: number;
  sessions_today?: TAttendanceSession[];
  last_check_in?: string | null;
  last_check_out?: string | null;
  server_time?: string;
};

export type TAttendanceError = {
  error: string;
  code?:
    | "unavailable"
    | "not_linked"
    | "location_required"
    | "location_invalid"
    | "already_checked_in"
    | "not_checked_in"
    | "conflict";
};

export class AttendanceService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getStatus(): Promise<TAttendanceStatus> {
    return this.get("/api/attendance/me/")
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Coordinates are mandatory — the API rejects a check-in without them. */
  async checkIn(coordinates: TAttendanceCoordinates): Promise<TAttendanceStatus> {
    return this.post("/api/attendance/check-in/", coordinates)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Coordinates are best-effort here: a check-out is never blocked on a fix. */
  async checkOut(coordinates?: TAttendanceCoordinates): Promise<TAttendanceStatus> {
    return this.post("/api/attendance/check-out/", coordinates ?? {})
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}

const attendanceService = new AttendanceService();

export default attendanceService;
