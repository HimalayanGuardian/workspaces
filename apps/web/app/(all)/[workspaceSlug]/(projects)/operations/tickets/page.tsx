/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// components
import { PageHead } from "@/components/core/page-title";
import { TicketList } from "@/components/operations";

/**
 * Requests from outside engineering, on their way to becoming work items — or not.
 */
function OperationsTicketsPage() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";

  return (
    <>
      <PageHead title="Operations requests" />
      <TicketList workspaceSlug={slug} />
    </>
  );
}

export default observer(OperationsTicketsPage);
