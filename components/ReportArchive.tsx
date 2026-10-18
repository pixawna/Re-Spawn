"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import FeatureDialog from "./FeatureDialog";
export default function ReportArchive({
  projectId,
  onClose,
  onSelect,
}: {
  projectId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [items, setItems] = useState<
    | {
        id: string;
        status: string;
        duration: number;
        routes_tried: number;
        archived: boolean;
      }[]
    | null
  >(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    api<NonNullable<typeof items>>(`/api/projects/${projectId}/reports`)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return (
    <FeatureDialog title={projectId} kicker="Report archive" onClose={onClose}>
      <p>
        Completed reports are saved locally and remain available after an API
        restart. Preview workspaces and live event streams have a separate
        lifetime.
      </p>
      {error && <p role="alert">{error}</p>}
      {!items && !error && <p role="status">Reading the archive…</p>}
      {items?.length === 0 && (
        <p>
          No reports yet. Start a resurrection to capture its diagnosis,
          decisions and verification.
        </p>
      )}
      {items?.map((item) => (
        <article className="report-chain" key={item.id}>
          <strong>
            {item.status} · {item.duration}s · {item.routes_tried} routes
          </strong>
          <p>
            {item.id} · {item.archived ? "Saved report" : "Current API session"}
          </p>
          <button className="btn-life" onClick={() => onSelect(item.id)}>
            Read report →
          </button>
        </article>
      ))}
    </FeatureDialog>
  );
}
