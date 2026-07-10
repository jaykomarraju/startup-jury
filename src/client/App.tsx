import { useEffect, useState } from "react";

interface Health {
  status: string;
  service: string;
}

export default function App() {
  const [status, setStatus] = useState("…");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<Health>)
      .then((d) => setStatus(d.status))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <main className="shell">
      <h1>ai.STARTUPJURY</h1>
      <p className="tagline">Venture intelligence first</p>
      <p data-testid="health">API health: {status}</p>
    </main>
  );
}
