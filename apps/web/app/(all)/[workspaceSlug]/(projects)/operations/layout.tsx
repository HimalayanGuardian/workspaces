/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { OperationsHeader } from "./header";

export default function OperationsLayout() {
  return (
    <>
      <AppHeader header={<OperationsHeader />} />
      <ContentWrapper>
        <div className="h-full w-full overflow-y-auto px-4 py-4 md:px-6">
          <Outlet />
        </div>
      </ContentWrapper>
    </>
  );
}
