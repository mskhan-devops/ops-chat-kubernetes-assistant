#!/usr/bin/env bash
# One-shot: ensure a kind cluster, deploy the demo stack, wait for payments-1 to
# crash-loop so the agent has an incident to investigate.
#
# Env:
#   KIND_CLUSTER_NAME   kind cluster name (default: my-cluster)
#   KUBE_NAMESPACE      target namespace   (default: demo)
set -euo pipefail

CLUSTER="${KIND_CLUSTER_NAME:-my-cluster}"
NAMESPACE="${KUBE_NAMESPACE:-demo}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "kind cluster '$CLUSTER' not found — creating it…"
  kind create cluster --name "$CLUSTER"
fi

CONTEXT="kind-${CLUSTER}"
kubectl --context "$CONTEXT" cluster-info >/dev/null
echo "using context: $CONTEXT"

kubectl --context "$CONTEXT" apply -f "$HERE/demo-workloads.yaml"

echo "waiting for payments-1 to start crash-looping (~60s)…"
for _ in $(seq 1 24); do
  if kubectl --context "$CONTEXT" get pod payments-1 -n "$NAMESPACE" 2>/dev/null \
      | grep -qE "CrashLoopBackOff|OOMKilled|Error"; then
    break
  fi
  sleep 5
done

kubectl --context "$CONTEXT" get pods -n "$NAMESPACE"
echo
echo "✅ ready. In phase2-chat-agent/.env(.local) set:"
echo "     KUBE_CONTEXT=$CONTEXT"
echo "     KUBE_NAMESPACE=$NAMESPACE"
echo "     USE_REAL_CLUSTER=true"
echo "   then run:  npm run dev"
