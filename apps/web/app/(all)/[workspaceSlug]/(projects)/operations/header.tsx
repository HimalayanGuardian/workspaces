/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
// plane imports
import { Breadcrumbs, Header } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { OPERATIONS_TABS } from "@/components/operations";

/**
 * The header for every operations screen.
 *
 * The tabs live here rather than in each page so that switching between them
 * does not remount the whole section, and so a new screen only has to be added
 * in one place.
 */
export const OperationsHeader = observer(function OperationsHeader() {
  const { workspaceSlug } = useParams();
  const pathname = usePathname();
  const base = `/${workspaceSlug?.toString()}/operations`;

  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <Breadcrumbs.Item component={<BreadcrumbLink label="Operations" />} />
        </Breadcrumbs>
      </Header.LeftItem>

      <Header.RightItem>
        <nav className="flex flex-wrap items-center gap-1">
          {OPERATIONS_TABS.map((tab) => {
            const href = tab.key ? `${base}/${tab.key}` : base;
            // The dashboard is the section root, so an `includes` test would
            // light it up on every child route.
            const isActive = tab.key ? pathname.startsWith(href) : pathname === base || pathname === `${base}/`;
            return (
              <Link
                key={tab.key || "dashboard"}
                href={href}
                className={cn(
                  "rounded-md px-2.5 py-1 text-13 font-medium transition-colors",
                  isActive
                    ? "bg-layer-transparent-selected text-primary"
                    : "text-secondary hover:bg-layer-transparent-hover"
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </Header.RightItem>
    </Header>
  );
});
