/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// components
import { PageHead } from "@/components/core/page-title";
import { MissingWorkLogs, WorkLogEditor, WorkLogHistory } from "@/components/operations";

/**
 * Your log for the day, your last thirty, and who on the team has not filed.
 */
function OperationsWorkLogsPage() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";

  return (
    <>
      <PageHead title="Work logs" />
      <div className="flex flex-col gap-4">
        <WorkLogEditor workspaceSlug={slug} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <WorkLogHistory workspaceSlug={slug} />
          <MissingWorkLogs workspaceSlug={slug} />
        </div>
      </div>
    </>
  );
}

export default observer(OperationsWorkLogsPage);
