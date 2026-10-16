"use client";

import { useEffect, useState } from "react";

type ClusterInfo = { context: string; cluster: string; namespace: string };

export function ClusterBadge() {
  const [info, setInfo] = useState<ClusterInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/cluster")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ClusterInfo) => {
        if (alive) setInfo(d);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const name = info?.cluster || info?.context || "";

  return (
    <div
      className="cluster-bar"
      title={info?.context ? `kubectl context: ${info.context}` : undefined}
    >
      <span className={`cluster-dot${name ? "" : " unknown"}`} aria-hidden="true" />
      {name ? (
        <>
          <span className="cluster-label">Cluster</span>
          <strong>{name}</strong>
          {info?.namespace ? (
            <span className="cluster-label">
              · namespace <strong>{info.namespace}</strong>
            </span>
          ) : null}
        </>
      ) : (
        <span className="cluster-label">
          {failed ? "Cluster not detected" : "Detecting cluster…"}
        </span>
      )}
    </div>
  );
}
