import { useEffect, useState } from "react";
import { Card, Button, Badge, KpiTile } from "../components";
import { getConfig, purchaseCredits } from "../api";

/**
 * Buy credits (Session 4) — mirrors the prototype's pay-as-you-go packs. This is
 * a DEMO TOP-UP: choosing a pack grants the credits instantly and records NO
 * payment. There is deliberately no card / UPI / bank capture — collecting real
 * payment credentials is out of scope. 1 credit = 1 deck; credits never expire.
 */

interface Pack {
  credits: number;
  price: number; // ₹
  perDeck: number;
  save?: string;
  featured?: boolean;
}

const PACKS: Record<"pro" | "premium", Pack[]> = {
  pro: [
    { credits: 20, price: 10000, perDeck: 500 },
    { credits: 35, price: 15750, perDeck: 450, save: "Save 10%", featured: true },
    { credits: 50, price: 20000, perDeck: 400, save: "Save 20%" },
  ],
  premium: [
    { credits: 20, price: 12000, perDeck: 600 },
    { credits: 35, price: 19250, perDeck: 550, save: "Save 8%", featured: true },
    { credits: 50, price: 25000, perDeck: 500, save: "Save 17%" },
  ],
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function BuyCreditsPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [tab, setTab] = useState<"pro" | "premium">("pro");
  const [busy, setBusy] = useState<number | null>(null);
  const [purchased, setPurchased] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConfig()
      .then((c) => setBalance(c.creditsBalance))
      .catch(() => setError("Couldn't load your credit balance."));
  }, []);

  async function buy(pack: Pack) {
    setBusy(pack.credits);
    setError(null);
    setPurchased(null);
    try {
      const res = await purchaseCredits(pack.credits);
      setBalance(res.creditsBalance);
      setPurchased(pack.credits);
    } catch {
      setError("Couldn't complete the top-up. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Buy credits</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">
          Top up evaluation credits — 1 credit = 1 deck, and credits never expire.
        </p>
      </div>

      {/* Demo-only disclosure: no real payment is processed. */}
      <div className="rounded-lg border border-amber/30 bg-amber/10 px-4 py-2.5 text-sm text-fg">
        <span className="font-medium">Demo mode.</span> Choosing a pack grants the credits instantly for the
        demo — no payment is processed and no card, UPI or bank details are collected.
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <KpiTile label="Credits balance" value={balance === null ? "…" : String(balance)} />
        {purchased !== null && (
          <Badge tone="positive">Added {purchased} credits</Badge>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}

      {/* Plan tabs */}
      <div className="flex gap-2">
        {(["pro", "premium"] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "primary" : "secondary"} onClick={() => setTab(t)}>
            {t === "pro" ? "Pro" : "Premium"}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {PACKS[tab].map((pack) => (
          <Card key={pack.credits} className={pack.featured ? "ring-1 ring-accent/40" : undefined}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-2xl font-semibold text-fg">{pack.credits}</div>
                <div className="u-label">credits</div>
              </div>
              {pack.save && <Badge tone="positive">{pack.save}</Badge>}
            </div>
            <div className="mt-3 text-lg font-semibold text-fg">{inr(pack.price)}</div>
            <div className="text-xs text-fg-muted">{inr(pack.perDeck)}/deck</div>
            <Button
              className="mt-4 w-full"
              variant="primary"
              disabled={busy !== null}
              onClick={() => buy(pack)}
            >
              {busy === pack.credits ? "Adding…" : "Buy credits"}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
