/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// components
import { PageHead } from "@/components/core/page-title";
import {
  AttendanceHistoryPanel,
  AttendanceToday,
  HolidayPanel,
  LeavePanel,
  TeamAvailabilityPanel,
  WorkingHoursPanel,
} from "@/components/operations";

/**
 * Everything Odoo holds about your attendance, without opening Odoo.
 */
function OperationsAttendancePage() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";

  return (
    <>
      <PageHead title="Attendance" />
      <div className="flex flex-col gap-4">
        <AttendanceToday />
        <AttendanceHistoryPanel />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <LeavePanel />
          <HolidayPanel />
          <WorkingHoursPanel />
          <TeamAvailabilityPanel workspaceSlug={slug} />
        </div>
      </div>
    </>
  );
}

export default observer(OperationsAttendancePage);
