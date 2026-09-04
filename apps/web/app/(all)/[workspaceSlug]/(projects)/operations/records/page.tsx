/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// components
import { PageHead } from "@/components/core/page-title";
import { RecordList } from "@/components/operations";

/**
 * Incidents, decisions and meetings — kept out of the work item tracker on purpose.
 */
function OperationsRecordsPage() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";

  return (
    <>
      <PageHead title="Records" />
      <RecordList workspaceSlug={slug} />
    </>
  );
}

export default observer(OperationsRecordsPage);
