import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { setCurrentActor, useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { TABLES, toColumn, toRow } from "@/lib/supabase/tables";
import { accessRightsOf, canDoAction } from "@/lib/permissions";
import type { ReceptionStaff } from "@/lib/types";

/**
 * UN ENCAISSEMENT SAISI PAR UN TRAVAILLEUR, DU GUICHET À LA CLOCHE DU DIRECTEUR.
 *
 * Le chemin complet, parce qu'il traverse quatre couches qui ne se parlent
 * qu'au moment où quelqu'un encaisse pour de vrai :
 *
 *  1. LE DROIT — le travailleur a-t-il le droit d'encaisser ? Ouvrir « Situation
 *     d'un élève » n'est PAS le droit de prendre de l'argent : ce sont deux
 *     cases distinctes, et la seconde doit être cochée.
 *  2. L'ÉCRITURE — le versement porte la signature de celui qui l'a saisi.
 *  3. LA PERSISTANCE — la ligne envoyée à Postgres doit être ACCEPTABLE. C'est
 *     ici que tout se jouait : `alert_read` est `not null`, personne ne
 *     renseigne `alertRead` à la création, et la ligne était refusée. Le
 *     versement vivait à l'écran jusqu'au rechargement, puis disparaissait — et
 *     la cloche du directeur, qui lit `payments`, restait éternellement vide.
 *  4. LA CLOCHE — le versement remonte à la direction tant qu'elle ne l'a pas lu.
 */

const SUB = "sub-1";
const STU = "stu-1";

/** La signature d'un travailleur : son compte porte le rôle « reception ». */
const WORKER = { id: "wrk-1", name: "Nadia Meziane", role: "reception" };
const ADMIN = { id: "adm-1", name: "Direction", role: "admin" };

beforeEach(() => {
  useData.setState(buildSeed());
  setCurrentActor(null);
});

afterEach(() => {
  setCurrentActor(null);
});

// ---------------------------------------------------------------------------
//  1. LE DROIT D'ENCAISSER
// ---------------------------------------------------------------------------

describe("encaisser est un droit à part entière", () => {
  const workerWith = (actionKeys: string[]): ReceptionStaff =>
    ({
      id: "wrk-1",
      firstName: "Nadia",
      lastName: "Meziane",
      phone: "",
      email: "",
      paymentType: "monthly",
      startDate: "2026-01-01",
      salary: 30000,
      navKeys: ["dashboard", "students"],
      actionKeys,
    }) as ReceptionStaff;

  const user = { id: "acc-1", role: "reception" as const, entityId: "wrk-1" };

  it("« Situation d'un élève » n'emporte PAS le droit de prendre de l'argent", () => {
    const rights = accessRightsOf(user, [workerWith(["dashboard:student_situation"])]);
    expect(canDoAction(rights, "dashboard", "student_situation")).toBe(true);
    // La case « Encaisser » n'a pas été cochée : consulter, oui ; encaisser, non.
    expect(canDoAction(rights, "dashboard", "collect_payment")).toBe(false);
    expect(canDoAction(rights, "students", "pay")).toBe(false);
  });

  it("le droit coché ouvre l'encaissement, sur la feuille comme sur la situation", () => {
    const rights = accessRightsOf(
      user,
      [workerWith(["dashboard:student_situation", "dashboard:collect_payment"])],
    );
    expect(canDoAction(rights, "dashboard", "collect_payment")).toBe(true);
  });

  it("une fiche dont les droits n'ont jamais été réglés garde tous ses boutons", () => {
    const legacy = { id: "wrk-1", firstName: "Nadia", lastName: "Meziane" } as ReceptionStaff;
    const rights = accessRightsOf(user, [legacy]);
    expect(canDoAction(rights, "dashboard", "collect_payment")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
//  2 & 3. L'ÉCRITURE, ET LA LIGNE QUE POSTGRES DOIT ACCEPTER
// ---------------------------------------------------------------------------

const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "schema.sql"), "utf8");

/** Les colonnes `not null` d'une table du schéma. */
function notNullColumnsOf(table: string): Set<string> {
  const start = sql.indexOf(`create table if not exists public.${table} (`);
  const open = sql.indexOf("(", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const out = new Set<string>();
  for (const raw of sql.slice(open + 1, end).split("\n")) {
    const line = raw.replace(/--.*$/, "").trim();
    if (!line || !/\bnot null\b/i.test(line)) continue;
    const name = line.split(/\s+/)[0];
    if (/^[a-z_][a-z0-9_]*$/.test(name)) out.add(name);
  }
  return out;
}

describe("un travailleur encaisse un solde", () => {
  it("signe le versement de SON nom et de SON rôle", async () => {
    setCurrentActor(WORKER);
    const res = await useData.getState().addSold({
      studentId: STU,
      subscriptionId: SUB,
      amount: 2000,
    });
    expect(res.ok).toBe(true);

    const payment = useData.getState().payments.find((p) => p.id === res.paymentId);
    expect(payment).toBeTruthy();
    expect(payment!.createdByRole).toBe("reception");
    expect(payment!.createdByName).toBe("Nadia Meziane");
    expect(payment!.amountPaid).toBe(2000);
    // Le mois de l'emploi du temps est renseigné tout seul.
    expect(payment!.monthCode).toBeTruthy();
  });

  it("écrit l'entrée en caisse qui va avec, signée elle aussi", async () => {
    setCurrentActor(WORKER);
    const before = useData.getState().cash.length;
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 1500 });

    const cash = useData.getState().cash.slice(before);
    expect(cash).toHaveLength(1);
    expect(cash[0].type).toBe("student_payment");
    expect(cash[0].amount).toBe(1500);
    expect(cash[0].createdByRole).toBe("reception");
  });

  /**
   * LE TEST QUI MANQUAIT. Le versement était bien créé À L'ÉCRAN — c'est la
   * ligne ENVOYÉE qui était refusée, et personne ne s'en apercevait avant le
   * rechargement suivant.
   */
  it("produit une ligne que Postgres accepte — aucun null dans une colonne not null", async () => {
    setCurrentActor(WORKER);
    const res = await useData.getState().addSold({
      studentId: STU,
      subscriptionId: SUB,
      amount: 2000,
    });
    const payment = useData.getState().payments.find((p) => p.id === res.paymentId)!;

    const spec = TABLES.payments;
    const row = toRow(spec, payment as unknown as Record<string, unknown>);
    const notNull = notNullColumnsOf(spec.table);

    for (const [column, value] of Object.entries(row)) {
      if (!notNull.has(column)) continue;
      expect(value, `payments.${column} would be rejected: not null, sent as null`).not.toBeNull();
    }
    // Celle qui faisait tomber chaque versement, nommément.
    expect(row.alert_read).toBe(false);
  });

  it("écrit une inscription et une entrée en caisse également acceptables", async () => {
    setCurrentActor(WORKER);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000 });
    const db = useData.getState();

    const rows: [string, Record<string, unknown>][] = [
      ["enrollments", db.enrollments.find((e) => e.studentId === STU)!],
      ["cash", db.cash[db.cash.length - 1]],
    ] as [string, Record<string, unknown>][];

    for (const [key, obj] of rows) {
      const spec = TABLES[key as "enrollments" | "cash"];
      const row = toRow(spec, obj);
      const notNull = notNullColumnsOf(spec.table);
      for (const [column, value] of Object.entries(row)) {
        if (!notNull.has(column)) continue;
        expect(value, `${spec.table}.${column} sent as null`).not.toBeNull();
      }
    }
  });

  it("chaque colonne du versement est bien une colonne de la table", async () => {
    setCurrentActor(WORKER);
    const res = await useData.getState().addSold({
      studentId: STU,
      subscriptionId: SUB,
      amount: 500,
    });
    const payment = useData.getState().payments.find((p) => p.id === res.paymentId)!;
    const spec = TABLES.payments;
    const declared = new Set(spec.fields.map((f) => toColumn(f, spec)));
    for (const column of Object.keys(toRow(spec, payment as unknown as Record<string, unknown>))) {
      expect(declared, `payments.${column} is not declared in the column map`).toContain(column);
    }
  });
});

// ---------------------------------------------------------------------------
//  4. LA CLOCHE DE LA DIRECTION
// ---------------------------------------------------------------------------

/** Ce que la cloche du tableau de bord retient — la règle du composant. */
function pendingAlerts() {
  return useData
    .getState()
    .payments.filter((p) => p.createdByRole === "reception" && !p.alertRead);
}

describe("la cloche du tableau de bord", () => {
  it("remonte l'encaissement d'un travailleur", async () => {
    setCurrentActor(WORKER);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000 });

    const pending = pendingAlerts();
    expect(pending).toHaveLength(1);
    expect(pending[0].createdByName).toBe("Nadia Meziane");
    expect(pending[0].amountPaid).toBe(2000);
  });

  it("ne remonte JAMAIS ce que la direction a saisi elle-même", async () => {
    setCurrentActor(ADMIN);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 3000 });
    expect(pendingAlerts()).toHaveLength(0);
  });

  it("retire le versement dès que la direction l'a marqué lu", async () => {
    setCurrentActor(WORKER);
    const res = await useData.getState().addSold({
      studentId: STU,
      subscriptionId: SUB,
      amount: 2000,
    });
    expect(pendingAlerts()).toHaveLength(1);

    setCurrentActor(ADMIN);
    useData.getState().updateItem("payments", res.paymentId!, { alertRead: true });
    expect(pendingAlerts()).toHaveLength(0);
  });

  it("« lu » reste « lu » une fois écrit en base et relu", async () => {
    setCurrentActor(WORKER);
    const res = await useData.getState().addSold({
      studentId: STU,
      subscriptionId: SUB,
      amount: 2000,
    });
    useData.getState().updateItem("payments", res.paymentId!, { alertRead: true });

    const payment = useData.getState().payments.find((p) => p.id === res.paymentId)!;
    const row = toRow(TABLES.payments, payment as unknown as Record<string, unknown>);
    expect(row.alert_read).toBe(true);
  });

  it("garde les encaissements de plusieurs travailleurs, du plus récent au plus ancien", async () => {
    setCurrentActor(WORKER);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 1000 });
    setCurrentActor({ id: "wrk-2", name: "Samir Hadj", role: "reception" });
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000 });

    const names = pendingAlerts()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((p) => p.createdByName);
    expect(names).toHaveLength(2);
    expect(new Set(names)).toEqual(new Set(["Nadia Meziane", "Samir Hadj"]));
  });
});

// ---------------------------------------------------------------------------
//  5. LE CÂBLAGE DES ÉCRANS
//
//  Les trois liens ci-dessous ne vivent que dans du JSX : aucun test de logique
//  ne les tient, et les débrancher ne casse rien — ça ouvre juste une porte, ou
//  éteint une alerte, sans que personne s'en aperçoive. On les lit donc dans la
//  source.
// ---------------------------------------------------------------------------

describe("le câblage des écrans", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  const CALL_SITES = [
    "app/(app)/dashboard/page.tsx",
    "components/pages/StudentsPage.tsx",
  ];

  for (const file of CALL_SITES) {
    it(`${file} n'ouvre jamais « Situation d'un élève » sans dire qui peut encaisser`, () => {
      const src = read(file);
      const uses = src.includes("<StudentSituationModal");
      expect(uses, `${file} n'utilise plus le composant — retirez-le de cette liste`).toBe(true);
      // Le composant autorise l'encaissement par défaut : un appel muet rouvre
      // le trou en silence.
      const block = src.slice(src.indexOf("<StudentSituationModal"));
      expect(
        block.slice(0, block.indexOf("/>") + 2),
        `${file} doit passer canCollect={...}`,
      ).toContain("canCollect=");
    });
  }

  it("le tableau de bord montre la bande d'alerte, et à la direction seule", () => {
    const src = read("app/(app)/dashboard/page.tsx");
    expect(src).toContain('<WorkerPaymentsAlert variant="banner" />');
    // Les deux rendus — la cloche et la bande — sont derrière `isAdmin`.
    for (const m of src.matchAll(/<WorkerPaymentsAlert[^/]*\/>/g)) {
      const before = src.slice(Math.max(0, m.index! - 60), m.index!);
      expect(before, `un rendu de l'alerte n'est pas réservé à l'administration`).toContain(
        "isAdmin",
      );
    }
  });

  it("la cloche lit bien le rôle « reception » et le drapeau de lecture", () => {
    const src = read("components/dashboard/WorkerPaymentsAlert.tsx");
    expect(src).toContain('p.createdByRole === "reception"');
    expect(src).toContain("!p.alertRead");
  });
});
