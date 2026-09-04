/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
// hooks
import { useProject } from "@/hooks/store/use-project";
// services
import { operationsService, type TDeveloperDashboardIssue } from "@/services/operations";
// local imports
import {
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  Pill,
  Section,
  StatTile,
  TileGrid,
  formatDateTime,
  formatHours,
} from "../common";
import { PRIORITY_CLASS, PRIORITY_LABEL } from "../constants";

type Props = { workspaceSlug: string; projectId?: string };

const QueueRow = observer(function QueueRow({
  workspaceSlug,
  issue,
}: {
  workspaceSlug: string;
  issue: TDeveloperDashboardIssue;
}) {
  const { getProjectById } = useProject();
  const project = getProjectById(issue.project_id);
  const priority = (issue.priority ?? "none") as keyof typeof PRIORITY_LABEL;

  return (
    <li className="flex items-center justify-between gap-3 border-b border-subtle py-2 last:border-0">
      <Link
        href={`/${workspaceSlug}/projects/${issue.project_id}/issues/${issue.id}`}
        className="flex min-w-0 items-center gap-2 hover:underline"
      >
        <span className="shrink-0 text-11 text-placeholder">
          {project?.identifier ?? "--"}-{issue.sequence_id}
        </span>
        <span className="truncate text-13 text-secondary">{issue.name}</span>
      </Link>
      <span className="flex shrink-0 items-center gap-2">
        <Pill className={PRIORITY_CLASS[priority]}>{PRIORITY_LABEL[priority]}</Pill>
        {/* Sorted oldest-first upstream, so this is "how long it has been sitting". */}
        <span className="text-11 text-placeholder">{formatDateTime(issue.target_date ?? null)}</span>
      </span>
    </li>
  );
});

/**
 * The QA queue.
 *
 * "Passed" and "failed" are counted off the state-transition trail rather than
 * from any test tooling: a move from QA Testing to Ready for Release is a pass,
 * a move back to development is a failure. That is the only definition the
 * workflow actually supports, and it is the one PROJECT.md's QA panel means.
 */
export const QADashboard = observer(function QADashboard({ workspaceSlug, projectId }: Props) {
  const { data, error, isLoading } = useSWR(
    workspaceSlug ? ["operations-dashboard-qa", workspaceSlug, projectId] : null,
    () => operationsService.getQADashboard(workspaceSlug, { project_id: projectId }),
    { revalidateOnFocus: false }
  );

  if (isLoading) return <LoadingPanel label="Loading the testing queue" />;
  if (error || !data) return <ErrorPanel />;

  return (
    <div className="flex flex-col gap-4">
      <TileGrid>
        <StatTile
          label="Ready to test"
          value={data.ready_for_testing.count}
          tone={data.ready_for_testing.count > 0 ? "warning" : "default"}
        />
        <StatTile label="In testing" value={data.in_testing.count} />
        <StatTile label="Passed (30d)" value={data.passed_30d} tone="positive" />
        <StatTile label="Failed (30d)" value={data.failed_30d} tone={data.failed_30d > 0 ? "danger" : "default"} />
        <StatTile label="Reopened bugs" value={data.reopened_bugs} />
        <StatTile
          label="Average QA time"
          value={data.average_qa_hours === null ? "--" : formatHours(data.average_qa_hours)}
          hint="Entering QA to leaving it"
        />
      </TileGrid>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Ready for testing" description="Oldest first — this is the queue">
          {data.ready_for_testing.items.length === 0 ? (
            <EmptyPanel label="The queue is empty" />
          ) : (
            <ul>
              {data.ready_for_testing.items.map((issue) => (
                <QueueRow key={issue.id} workspaceSlug={workspaceSlug} issue={issue} />
              ))}
            </ul>
          )}
        </Section>

        <Section title="In testing" description="Currently with QA">
          {data.in_testing.items.length === 0 ? (
            <EmptyPanel label="Nothing is being tested right now" />
          ) : (
            <ul>
              {data.in_testing.items.map((issue) => (
                <QueueRow key={issue.id} workspaceSlug={workspaceSlug} issue={issue} />
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Waiting on release" description="Passed QA and waiting on DevOps">
        <StatTile label="Ready for release" value={data.waiting_release} tone="positive" />
      </Section>
    </div>
  );
});
