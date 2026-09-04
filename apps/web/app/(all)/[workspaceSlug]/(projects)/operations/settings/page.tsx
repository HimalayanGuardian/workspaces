/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// components
import { PageHead } from "@/components/core/page-title";
import { OperationsSettings } from "@/components/operations";

/**
 * The state mapping every dashboard is phrased in, and the workflow bootstrap.
 */
function OperationsSettingsPage() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";

  return (
    <>
      <PageHead title="Operations settings" />
      <OperationsSettings workspaceSlug={slug} />
    </>
  );
}

export default observer(OperationsSettingsPage);
