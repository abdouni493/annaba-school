"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listStudents, getStudent, type StudentCursor, type StudentPage } from "@/lib/repo/students";
import { useSession } from "@/lib/store/session";
import { useCan } from "@/lib/usePermissions";
import { useSettings } from "@/lib/store/settings";
import type { Student } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";

/** Bounded read-only directory. The complete legacy financial workspace remains
 * an explicit destination until its ledger-dependent filters are migrated. */
export function StudentDirectoryPage() {
  const account = useSession((s) => s.user?.id);
  const ar = useSettings((s) => s.language === "ar");
  const can = useCan("students");
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setRefreshKey((key) => key + 1); };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<StudentCursor | null>(null);
  const [page, setPage] = useState<StudentPage | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Student | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(false);
      void listStudents({ search, cursor, signal: abort.signal }).then((next) => {
        if (!abort.signal.aborted) setPage(next);
      }).catch(() => {
        if (!abort.signal.aborted) { setError(true); setPage(null); }
      }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [account, search, cursor, refreshKey]);
  useEffect(() => {
    if (!detailId || !can("view")) return;
    const abort = new AbortController();
    void getStudent(detailId, abort.signal).then((student) => {
      if (!abort.signal.aborted) setDetail(student);
    }).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [account, detailId, can]);
  return <section className="space-y-4" aria-busy={loading}>
    <h1 className="text-2xl font-bold">{ar ? "الطلاب" : "Élèves"}</h1>
    <Link className="text-primary underline" href="/students/complete">{ar ? "الملفات والأرصدة والتصفية المالية" : "Dossiers, soldes et filtres financiers"}</Link>
    <label className="block">
      <span>{ar ? "الاسم، رقم التسجيل، الهاتف أو البريد الإلكتروني" : "Nom, matricule, téléphone ou email"}</span>
      <input className="block w-full rounded-xl border border-line bg-surface p-3" value={search}
        onChange={(e) => { setSearch(e.target.value); setCursor(null); setPage(null); setLoading(true); }} />
    </label>
    {error && <p role="alert">{ar ? "تعذر تحميل البيانات. أعد المحاولة." : "Lecture impossible. Modifiez la recherche pour réessayer."}</p>}
    <p role="status">{loading ? (ar ? "جار التحميل…" : "Chargement…") :
      (ar ? `${page?.items.length ?? 0} نتيجة في هذه الصفحة` : `${page?.items.length ?? 0} résultat(s) sur cette page`)}</p>
    <ul className="divide-y divide-line rounded-xl border border-line">
      {!loading && page?.items.map((student) => <li key={student.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
        <span>{student.lastName} {student.firstName} · {student.registrationNumber ?? "—"}<br />
          <span className="text-sm text-muted">{student.phone} {student.phone2} {student.email}</span></span>
        {can("view") && <button className="text-primary underline" onClick={() => { setDetail(null); setDetailId(student.id); }}>{ar ? "الملف" : "Fiche"}</button>}
      </li>)}
    </ul>
    <div className="flex gap-4">
      {cursor && <button onClick={() => { setCursor(null); setLoading(true); }}>{ar ? "البداية" : "Début"}</button>}
      {page?.nextCursor && <button disabled={loading} onClick={() => { setCursor(page.nextCursor); setLoading(true); }}>{ar ? "التالي" : "Suivant"}</button>}
    </div>
    {detailId && <Modal open title={ar ? "ملف الطالب" : "Fiche élève"} onClose={() => { setDetailId(null); setDetail(null); }}>
      {detail ? <div className="space-y-3"><h2>{detail.lastName} {detail.firstName}</h2>
        <p>{detail.registrationNumber} · {detail.phone} · {detail.phone2}</p><p>{detail.email}</p>
        <Link className="text-primary underline" href="/students/complete">{ar ? "السجل والمدفوعات" : "Inscriptions, historique et paiements"}</Link></div> : <p>{ar ? "جار التحميل…" : "Chargement…"}</p>}
    </Modal>}
  </section>;
}
