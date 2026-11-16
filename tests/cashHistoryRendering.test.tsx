// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { CashPage } from "@/components/pages/CashPage";
import { useData } from "@/lib/store/data";
import { buildSeed } from "./fixtures/seed";

it("bounds visible payment history while retaining all-period totals and read-only expansion", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const db = buildSeed();
  db.payments = Array.from({length:150}, (_, i) => ({ ...db.payments[0], id:`history-${i}`, amountPaid:100, paidFrom:"cash" as const }));
  db.teacherPayments = [];
  db.cash = Array.from({length:150}, (_, i) => ({ id:`cash-${i}`, type:"deposit" as const,
    amount:100, date:new Date(2026,0,1,0,0,i).toISOString(), description:"Synthetic deposit" }));
  useData.getState().reset();
  useData.setState(db);
  const before = JSON.stringify(useData.getState());
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<CashPage />));
    const button = host.querySelector('button[aria-label="Afficher plus de paiements élèves"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    const history = button.parentElement!;
    expect(history.querySelectorAll("tbody tr")).toHaveLength(50);
    const text = () => history.textContent!.replace(/\s+/g," ");
    expect(text()).toContain("15 000");
    expect(text()).toContain("150");
    await act(async () => button.click());
    expect(history.querySelectorAll("tbody tr")).toHaveLength(100);
    expect(text()).toContain("15 000");
    expect(JSON.stringify(useData.getState())).toBe(before);
    const deposits = () => [...host.querySelectorAll("tbody tr")].filter((row) => row.textContent?.includes("Synthetic deposit"));
    expect(deposits()).toHaveLength(50);
    // The newest displayed balance includes the 100 older, undisplayed rows.
    expect(deposits()[0].querySelectorAll("td")[6].textContent!.replace(/\s+/g," ")).toContain("15 000");
    const moreJournal = host.querySelector('button[aria-label="Afficher plus de transactions"]') as HTMLButtonElement;
    await act(async () => moreJournal.click());
    expect(deposits()).toHaveLength(100);
    expect(JSON.stringify(useData.getState())).toBe(before);
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
});
