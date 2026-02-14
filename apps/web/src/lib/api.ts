import { DashboardSnapshot, UserContext } from "../types";

async function jsonOrThrow<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function getDashboard(): Promise<DashboardSnapshot> {
  return jsonOrThrow<DashboardSnapshot>("/api/dashboard");
}

export function updateContext(payload: Partial<UserContext>): Promise<{ context: UserContext }> {
  return jsonOrThrow<{ context: UserContext }>("/api/context", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
