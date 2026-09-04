/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// components
import { PageHead } from "@/components/core/page-title";
import { DeploymentList } from "@/components/operations";

/**
 * What went out, when, and whether it stayed out.
 */
function OperationsDeploymentsPage() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";

  return (
    <>
      <PageHead title="Deployments" />
      <DeploymentList workspaceSlug={slug} />
    </>
  );
}

export default observer(OperationsDeploymentsPage);
