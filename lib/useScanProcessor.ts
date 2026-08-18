"use client";

import { useCallback } from "react";
import { useData, uid, type ScanResult } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { studentDebt, studentName, totalRemainingSeances } from "@/lib/helpers";
import { speakMessage, speechCaseForScan } from "@/lib/speech";
import { buildBalanceAlert } from "@/lib/whatsapp/alert";
import type { Parent, School, Student } from "@/lib/types";

/** Alertes automatiques déjà traitées dans cette session applicative, pour ne
 *  pas rejouer la même si le scan accepté est traité deux fois (double
 *  déclenchement de l'événement clavier, remontage React). Clé stable = élève +
 *  séance + jour. */
const sentAlertKeys = new Set<string>();

/** Alerte automatique de solde. En mode démo il n'y a aucune passerelle Meta :
 *  le message est composé exactement comme en production (pour vérifier la
 *  résolution destinataire et le modèle), puis simplement journalisé. La
 *  notification interne au parent, elle, est bien écrite par l'appelant. */
async function sendAutoBalanceAlert(opts: {
  student: Student;
  remainingSeances: number;
  debt: number;
  parent?: Parent | null;
  school?: School | null;
  lang: "fr" | "ar";
  low: boolean;
  dedupKey: string;
}): Promise<void> {
  if (sentAlertKeys.has(opts.dedupKey)) return;

  const payload = buildBalanceAlert({
    student: {
      ...opts.student,
      remainingSeances: opts.remainingSeances,
      debt: opts.debt,
    },
    parent: opts.parent,
    school: opts.school,
    lang: opts.lang,
    low: opts.low,
  });
  // Aucun numéro exploitable (ni parent ni élève), ou rien à signaler.
  if (!payload) return;

  sentAlertKeys.add(opts.dedupKey);
  console.info(
    `[demo] alerte WhatsApp non envoyée (mode démo) — destinataire ${payload.name ?? payload.phone}`,
  );
}

/**
 * The single check-in pipeline shared by every entry point — the hardware
 * RFID reader (GlobalRFIDListener) and the manual scanner of the topbar
 * (ScanModal). Both run the same scan_card RPC, the same voice announcement,
 * the same toasts and the same automatic low-balance/debt parent alerts, so
 * a manually typed code behaves exactly like a card swipe.
 */
export function useScanProcessor() {
  const db = useData();
  const { scanCard, scanWorkerCard, students, parents, school, push } = db;
  const { language, autoSendWhatsapp, autoSendEmail } = useSettings();
  const { addToast } = useToast();

  const processScan = useCallback(
    async (code: string): Promise<ScanResult> => {
      const result = await scanCard(code);

      // Same reader for both populations: a badge unknown to the students
      // table is retried against the workers table (pointage arrivée/départ)
      // before it is declared unreadable.
      if (result.messageKey === "scan.notFound") {
        const worker = await scanWorkerCard(code);
        if (worker.ok || worker.messageKey === "worker.frozen") {
          const hours = worker.minutes !== undefined ? (worker.minutes / 60).toFixed(2) : undefined;
          const workerMessages: Record<string, { title: string; message: string; type: "success" | "info" | "warning" }> = {
            "worker.clockIn": {
              title: "Arrivée pointée",
              message: "Début de journée enregistré. Badgez à nouveau en partant pour clôturer la journée.",
              type: "success",
            },
            "worker.clockOut": {
              title: "Départ pointé",
              message: `Journée clôturée — ${hours ?? "0"} h travaillées.`,
              type: "success",
            },
            "worker.alreadyClosed": {
              title: "Journée déjà clôturée",
              message: `La journée est déjà pointée (${hours ?? "0"} h). Aucun changement.`,
              type: "info",
            },
            "worker.frozen": {
              title: "Journée gelée",
              message:
                "Une journée précédente a été ouverte sans pointage de sortie : les heures sont gelées. Corrigez l'heure de fin depuis la fiche du travailleur.",
              type: "warning",
            },
          };
          const info = workerMessages[worker.messageKey];
          addToast({
            type: info?.type ?? "info",
            title: info?.title ?? "Pointage travailleur",
            message: info?.message ?? "",
            studentName: worker.workerName,
          });
          return { ok: worker.ok, messageKey: worker.messageKey };
        }
      }

      const student = result.studentId
        ? students.find((s) => s.id === result.studentId)
        : undefined;

      // Voice announcement (pre-recorded clips in public/speech/) — played
      // AFTER the check-in RPC verdict is known. Five verdicts only: dette,
      // solde insuffisant, bienvenue, déjà scanné, carte introuvable. Every
      // other rejection stays visual-only.
      const speechCase = speechCaseForScan(result);
      if (speechCase) {
        speakMessage(speechCase, student ? studentName(student) : "", language);
      }

      if (result.messageKey === "scan.cooldown") {
        // Accidental double swipe inside the 30-minute window: ignored
        // completely (no deduction, no presence) — gentle feedback only.
        addToast({
          type: "info",
          title: "Déjà enregistré / تم التسجيل مسبقًا",
          message: "Passage ignoré : moins de 30 minutes depuis le dernier scan accepté sur CE créneau. Aucun débit, aucune présence dupliquée. (Un autre cours ou un autre groupe reste scannable immédiatement.)",
          studentName: student ? studentName(student) : undefined,
        });
        return result;
      }

      if (result.ok && student) {
        // The alert now watches SÉANCES, not money: the inscription is empty,
        // or it is down to its last couple of séances.
        const remaining = result.remaining;
        const isEmpty = !!result.outOfSeances || (!student.isFree && remaining === 0);
        const isLow = !student.isFree && remaining !== undefined && remaining > 0 && remaining <= 2;

        let autoSentAlert = false;

        if ((isLow || isEmpty) && (autoSendWhatsapp || autoSendEmail)) {
          autoSentAlert = true;

          // Notification interne au parent — inchangée : c'est la trace visible
          // dans l'espace parent, indépendante de l'envoi WhatsApp.
          if (student.parentId) {
            const parentId = student.parentId;
            const newNtf = {
              id: uid("ntf"),
              parentId,
              title: isEmpty
                ? "Alerte: séances épuisées (Automatique)"
                : "Alerte: séances bientôt épuisées (Automatique)",
              description: `${student.firstName} ${student.lastName} ${
                isEmpty
                  ? "n'a plus de séance sur ce module"
                  : `n'a plus que ${remaining} séance(s) sur ce module`
              }${result.moduleName ? ` (${result.moduleName})` : ""}. Merci de régulariser à la réception.`,
              date: new Date().toISOString(),
              read: false,
              auto: true,
            };
            push("notifications", newNtf);
          }

          // Transport WhatsApp réel — conditionné au seul interrupteur WhatsApp,
          // et non bloquant : le verdict du scan et son toast s'affichent sans
          // attendre la passerelle, et un échec d'envoi reste sans effet sur la
          // présence et le débit déjà écrits. Le parent rattaché est visé en
          // priorité ; à défaut, l'élève lui-même (résolu dans buildBalanceAlert).
          if (autoSendWhatsapp) {
            const parent = student.parentId
              ? parents.find((p) => p.id === student.parentId)
              : undefined;
            void sendAutoBalanceAlert({
              student,
              remainingSeances: totalRemainingSeances(db, student.id),
              debt: studentDebt(db, student.id),
              parent,
              school,
              lang: language === "ar" ? "ar" : "fr",
              low: isLow,
              dedupKey: `${student.id}:${result.sessionId ?? "?"}:${new Date().toLocaleDateString("fr-CA")}`,
            });
          }
        }

        // The séance the badge was matched to — including the GROUP, because a
        // student may follow another group of the same cours (rattrapage).
        const sessionInfo = result.moduleName
          ? `${result.moduleName}${result.groupName ? ` — ${result.groupName}` : ""}${
              result.sessionStart ? ` (${result.sessionStart} - ${result.sessionEnd})` : ""
            }`
          : undefined;
        const isLate = result.messageKey === "scan.successLate";
        const isAlready = result.messageKey === "scan.alreadyPresent";
        // Période gratuite: the presence is written exactly as usual, only the
        // deduction is skipped — so reception sees what was offered, not a bug.
        const isFreePeriod = !!result.free;
        const freeNote = isFreePeriod
          ? ` PÉRIODE GRATUITE${result.freePeriodName ? ` « ${result.freePeriodName} »` : ""} : séance offerte, aucune séance décomptée.`
          : "";
        // Inscription enregistrée avec une date de début future : la présence
        // est écrite exactement comme d'habitude, mais aucune séance n'est
        // décomptée tant que l'abonnement n'a pas commencé.
        const isPreStart = !!result.preStart;
        const preStartNote = isPreStart
          ? ` ABONNEMENT PAS ENCORE COMMENCÉ${
              result.enrollmentStart ? ` (début le ${result.enrollmentStart.split("-").reverse().join("/")})` : ""
            } : séance offerte, aucune séance décomptée.`
          : "";
        const substitution = result.otherGroup
          ? ` Rattrapage : présence enregistrée sur le groupe ${result.groupName ?? "suivi"}${
              result.ownGroupName ? ` (inscrit en ${result.ownGroupName})` : ""
            }.`
          : "";
        // Séances épuisées — l'entrée n'est JAMAIS bloquée pour autant : la
        // présence est écrite et signalée pour régularisation à la caisse.
        const emptyNote = result.outOfSeances
          ? " ⚠️ Aucune séance restante — séance à régulariser à la réception."
          : result.exhausted
            ? " ⚠️ Séances épuisées pour ce module — pensez à recharger."
            : "";

        // Show success toast — with the exact séance the scan was matched to
        addToast({
          type: isEmpty ? "warning" : isLate ? "warning" : isAlready ? "info" : "success",
          title: isAlready
            ? "Déjà pointé — aucune séance décomptée"
            : result.outOfSeances
              ? "Présence enregistrée — AUCUNE SÉANCE RESTANTE"
              : isFreePeriod
                ? "Présence Enregistrée — GRATUIT"
                : isPreStart
                  ? "Présence Enregistrée — AVANT LE DÉBUT (aucune séance décomptée)"
                  : isLate
                    ? "Présence en Retard"
                    : result.otherGroup
                      ? "Présence Enregistrée — Rattrapage"
                      : "Présence Enregistrée",
          message: isAlready
            ? `L'élève a déjà pointé pour ${sessionInfo ?? "cette séance"} aujourd'hui.${substitution}`
            : `${isLate ? "Présence validée avec RETARD" : "Présence enregistrée avec succès"}${
                sessionInfo ? ` — ${sessionInfo}` : ""
              }.${substitution}${freeNote}${preStartNote}${emptyNote}`,
          studentName: studentName(student),
          cost: result.cost,
          // Carries the SÉANCES left on the inscription (see the toast card).
          newBalance: result.remaining,
          autoSentAlert,
          waived: result.waived,
          freePeriodName: isFreePeriod ? result.freePeriodName ?? "période en cours" : undefined,
        });
      } else {
        // Show failure toast — surface the exact reason so reception sees why
        // the card was rejected (wrong day / too early / séance finished /
        // expired subscription / unknown card).
        const failureMessages: Record<string, string> = {
          "scan.notFound": "Carte RFID introuvable ou non associée.",
          "scan.noSessionToday": "Aucune séance de son niveau/module aujourd'hui — carte refusée.",
          "scan.noSessionNow": "Ce n'est pas l'heure de la séance de cet élève.",
          "scan.tooEarly": `Trop tôt — la séance n'a pas encore commencé.${result.nextStart ? ` Prochaine séance à ${result.nextStart}.` : ""}`,
          "scan.sessionEnded": "Séance déjà terminée — scan refusé, l'élève est compté ABSENT.",
          "scan.subscriptionExpired": "Abonnement EXPIRÉ pour ce module — carte refusée. Renouvelez l'inscription à la réception.",
          "scan.notEligible": "La séance en cours est d'un autre niveau ou d'un module non affecté à cet élève — carte refusée.",
          "scan.noSession": "Aucune séance active trouvée pour cet élève en ce moment.",
          "scan.error": "Erreur lors du scan — veuillez réessayer.",
        };
        addToast({
          type: "danger",
          title:
            result.messageKey === "scan.subscriptionExpired"
              ? "Entrée Refusée — ABONNEMENT EXPIRÉ"
              : "Échec du Scan",
          message:
            failureMessages[result.messageKey] ??
            "Aucune séance active trouvée pour cet élève en ce moment.",
          studentName: student ? studentName(student) : undefined,
        });
      }

      return result;
    },
    [scanCard, scanWorkerCard, students, parents, school, language, autoSendWhatsapp, autoSendEmail, addToast, push],
  );

  return processScan;
}
