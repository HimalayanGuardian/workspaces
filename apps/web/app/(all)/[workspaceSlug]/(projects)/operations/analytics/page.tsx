/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// components
import { PageHead } from "@/components/core/page-title";
import { OperationsAnalytics } from "@/components/operations";

/**
 * Delivery, quality, productivity and team metrics, generated from work already done.
 */
function OperationsAnalyticsPage() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";

  return (
    <>
      <PageHead title="Engineering analytics" />
      <OperationsAnalytics workspaceSlug={slug} />
    </>
  );
}

export default observer(OperationsAnalyticsPage);
