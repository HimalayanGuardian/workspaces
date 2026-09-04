/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// components
import { PageHead } from "@/components/core/page-title";
import { OperationsReports } from "@/components/operations";

/**
 * Weekly, monthly, sprint, executive and team reports, ready to paste into an email.
 */
function OperationsReportsPage() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";

  return (
    <>
      <PageHead title="Reports" />
      <OperationsReports workspaceSlug={slug} />
    </>
  );
}

export default observer(OperationsReportsPage);
