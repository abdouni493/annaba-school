# ALTECH SCHOOL — Fonctionnalités de l'application / وظائف التطبيق

> Application web de gestion d'école privée (cours de soutien, formations).
> تطبيق ويب لتسيير المدارس الخاصة (دروس الدعم والتكوين).

- [🇫🇷 Version française](#-version-française)
- [🇩🇿 النسخة العربية](#-النسخة-العربية)

---

# 🇫🇷 Version française

## 1. Présentation générale

ALTECH SCHOOL gère tout le quotidien d'une école privée : inscriptions, emplois du temps, présences par carte RFID, encaissements, dettes des élèves, paie des enseignants et du personnel, caisse, dépenses, rapports financiers et communication avec les familles.

**Points forts**

- Application web : fonctionne sur PC, tablette et téléphone, sans installation.
- Données en ligne et sécurisées (base PostgreSQL / Supabase) : rien n'est perdu au rechargement, plusieurs postes travaillent en même temps.
- Interface **bilingue français / arabe** (arabe de droite à gauche).
- **Thème clair / sombre**.
- **5 types de comptes** : administrateur, travailleur (réception…), enseignant, élève, parent.
- Chaque opération garde la trace de **qui l'a faite** (nom et rôle).
- Impression de reçus, fiches, feuilles de présence et fiches de paie au nom et au logo de l'école.

## 2. Comptes, connexion et droits d'accès

- Connexion par **email et mot de passe**.
- Création du **premier administrateur** directement depuis la page de connexion (une seule fois).
- Les comptes enseignants, travailleurs, élèves et parents sont créés depuis l'application, sans email de confirmation.
- **Droits d'accès à la carte** pour chaque travailleur : l'administrateur coche **écran par écran et bouton par bouton** ce que la personne peut voir et faire (ex. : peut encaisser mais pas supprimer un paiement).
- Changement de mot de passe et d'email de connexion.
- Chaque rôle arrive sur son propre espace après connexion.

## 3. Tableau de bord

- **Grille de la journée** : une ligne par créneau horaire, une colonne par salle, une couleur fixe par emploi du temps.
- Navigation **jour précédent / suivant**, choix d'une date, bouton « Aujourd'hui » : on peut pointer une séance oubliée hier ou préparer demain.
- Avancement du jour : créneaux pointés / restants, nombre de pointages.
- **Recherche** et filtres (classe, année, module, enseignant) sur tous les emplois du temps.
- Raccourcis de caisse : **dépôt, dépense, retrait**.
- Bouton **Situation d'un élève** et bouton **Nouvel élève**.
- **Cloche d'alertes** : nouveaux paiements, alertes de séances libres, paiements des travailleurs.

## 4. Classes et niveaux

- Création des niveaux (primaire, moyen, secondaire…), classes/années et catégories.
- Consultation, modification, suppression.

## 5. Emplois du temps (planning)

- Création d'un emploi du temps en choisissant d'abord les **jours**, puis classe, module, groupe, salle et enseignant.
- **Horaires différents pour chaque jour** (ex. samedi 08:00–10:00, mardi 14:00–16:00 dans le même emploi).
- **Salle différente pour chaque jour**, avec vérification automatique de la **disponibilité des salles** (salle occupée → indique quel emploi la bloque).
- Noms de salles uniques.
- Un créneau peut réunir **plusieurs niveaux**, chacun avec ses groupes.
- Recherche de l'enseignant par nom ou téléphone.
- Créneaux de **séances libres**.
- **Archivage** au lieu de suppression : présences, paiements et paie restent dans l'historique.
- **Impression** des horaires.
- Vue semaine.

## 6. Tarifs et abonnements

- Un tarif par cours, appliqué à tous ses groupes : **prix à la séance** et/ou **prix au mois** (nombre de séances par mois + prix du pack, librement modifiable).
- Les prix acceptent les **centimes** (décimales).
- Tarif et **part de l'école / part de l'enseignant** réglables emploi du temps par emploi du temps.
- **Périodes gratuites / portes ouvertes** (avec option « enseignants non payés »).
- **Frais d'inscription** : applicables à tous, à un niveau, à certaines classes ou à certains emplois du temps.
- Détail, modification et archivage d'un abonnement.

## 7. Élèves

**Fiche élève**
- Identité, **numéro d'inscription**, deux téléphones (plusieurs élèves peuvent partager le même téléphone, ex. frères et sœurs), photo, niveau et année, carte **RFID**, compte de connexion.
- Création et modification sur le **même écran** : identité, cas de facturation, emplois du temps, soldes.
- Inscription à un emploi du temps : l'élève **entre là où en est le groupe** (mois M1, M2… et numéro de séance), le jour d'inscription compte, jamais l'heure.
- **Désinscription** d'un groupe sans perte d'historique, et **réinscription** possible.

**Cas de facturation** (réglables emploi du temps par emploi du temps)
- **Normal**.
- **Gratuit / offert**.
- **Réduction** (% ou montant fixe).
- **Fils/fille d'enseignant** : la scolarité peut être retenue sur le salaire du parent enseignant, ou réglée d'avance au guichet.
- **École seulement** : l'élève ne paie que la part de l'école (l'enseignant n'est pas payé pour lui).
- Changement de cas avec choix de ce qu'on fait des dettes existantes.

**Paiements**
- Paiement **par mois** (M1, M2…) ou **par séance** ; chaque emploi du temps a son propre solde (grand livre).
- Remise, montant payé, **reste à payer** ; un trop-perçu reste en avance sur le solde.
- Choix de la **date** d'encaissement.
- **Correction** et **suppression** d'un paiement (la caisse est corrigée du même écart).
- **Réimpression** du reçu, impression de la fiche de l'élève et du **relevé de paiements**.
- **Frais & dettes divers** : livre, tenue, sortie, transport, dégâts… créés, encaissés partiellement ou totalement.
- **Avances de l'école** : la caisse peut avancer les séances impayées d'un élève pour payer l'enseignant, puis se faire rembourser.
- **Situation d'un élève** : un grand tableau, une ligne par emploi du temps (actuels et quittés) avec séances du mois, versé, reste dû, arriérés et solde, plus les frais.
- Alertes de dette sur la fiche.
- Envoi de **messages WhatsApp** (dette, séances épuisées/faibles, inscription, message libre) en français ou en arabe.
- Scan de carte RFID pour retrouver un élève.

## 8. Présences

- **Scan de carte RFID** (lecteur global, fonctionne sur tout l'écran) ou **feuille de présence** manuelle.
- Statuts : présent, absent, retard, **séance annulée**.
- Sur la feuille de présence d'un groupe :
  - **Nouvel élève**, **Élève existant** (recherche par nom, n° ou téléphone), **Élève passager** (vient une seule fois, sans fiche) ;
  - **Tout présent** en un clic ;
  - **Séance annulée pour tous** (rien n'est consommé ni payé) ;
  - **Encaissement** direct, historique des paiements par élève, correction sur place ;
  - **Bandeau des dettes** : élèves en dette sur ce cours (scolarité, frais, avances de l'école) et signal des dettes sur d'autres emplois, encaissables depuis la feuille ;
  - Désinscription d'un élève.
- Retirer une présence ou une absence **rend la séance** et annule la part de l'enseignant non encore payée.
- Élève sans séance restante : accepté mais signalé « à régulariser » ; abonnement expiré : carte refusée.
- Absences facturées selon les règles de l'école.
- Impression de la **feuille de présence**.

## 9. Enseignants et paie

- Fiche enseignant avec compte de connexion ; **enseignant de passage** (sans compte).
- Trois modes de rémunération :
  - **Mensuel** (salaire fixe) ;
  - **Pourcentage** du prix des séances ;
  - **Par groupe** (part fixe par séance définie sur l'emploi du temps).
- **Paie mois par mois**, un tableau par groupe lu comme la feuille de présence ; calcul du net.
- Table **« Retards de paiement & séances libres »** : parts débloquées plus tard (élèves ayant payé après coup, passagers, séances libres).
- Part retenue tant que l'élève est en dette (sauf si l'école avance).
- **Acomptes**, **absences / retenues**, **dépenses** portées sur l'enseignant.
- Scolarité des enfants de l'enseignant déduite du salaire.
- Détail, correction, **annulation** d'un règlement (tout redevient dû), réimpression.
- **Fiches de paie** et rapports de paie imprimables par période (la part de l'école n'apparaît jamais sur la fiche de l'enseignant).

## 10. Travailleurs (personnel)

- **Métiers** créés librement par l'école (réception, ménage, surveillant…).
- Rémunération : **journalière, mensuelle, demi-journée ou horaire**.
- Activation d'un **compte de connexion** et attribution des **droits d'accès**.
- **Acomptes**, **absences**, **règlement** de la paie, **historique de travail**.
- **Pointage par badge**.
- Impression des reçus et fiches de paie.

## 11. Séances libres

- **Séances libres de groupe** : enseignant, date, horaires, nombre d'élèves, prix par élève, part de l'école → calcul automatique du total encaissé, de la part école et de la part enseignant.
- **Élèves de passage** : un nom par ligne (ou « Passager »), un seul mouvement de caisse pour tous.
- Séance libre pour un **élève inscrit** (payée en espèces, sans toucher ses soldes).
- **Séances libres solo** : pour un ou plusieurs élèves nommés hors de tout groupe, avec suivi de la part de l'enseignant (versée / non versée) et alerte.
- Détail, modification, suppression, **réimpression** du reçu.

## 12. Parents

- Fiches et comptes des parents, liés à leurs enfants.
- Envoi de messages (WhatsApp, notification).

## 13. Annonces

- Publication d'annonces pour les élèves, les parents et/ou les enseignants ; modification et suppression.

## 14. Caisse et dépenses

- **Caisse en temps réel** : dépôts, retraits, dépenses, encaissements d'élèves, règlements d'enseignants et de travailleurs, séances libres.
- Modification et suppression d'un mouvement.
- Historique des paiements des élèves consultable dans la caisse.
- **Dépenses** par catégorie : saisie, modification, suppression.

## 15. Rapports financiers et statistiques

- **Rapports** sur une période : encaissements élèves, séances vendues, remises, règlements de dettes, séances restantes, restes à payer, recette des séances, parts enseignants non payées, marge brute, abonnements actifs, acomptes et retenues des enseignants… Chaque chiffre s'ouvre sur la liste qui le compose.
- **Statistiques / analytique** : affluence par classe et par enseignant, taux de présence, retards, pic d'affluence, évolution du nombre d'élèves, graphiques imprimables.

## 16. Espaces personnels

| Espace | Ce qu'on y trouve |
|---|---|
| **Enseignant** | Tableau de bord, emploi du temps, appel des présences, salaire, ses classes et élèves, devoirs et fiches d'exercices à publier, annonces, profil |
| **Élève** | Accueil, emploi du temps, présences et absences, historique des paiements et séances restantes, documents de cours, annonces, profil |
| **Parent** | Accueil, ses enfants (séances restantes, inscriptions), planning par enfant, paiements, notifications, documents, annonces, compte |

## 17. Paramètres

- **Établissement** : nom, logo, coordonnées, identifiants fiscaux (utilisés sur tous les documents imprimés).
- **Sécurité** : changement de son mot de passe.
- **WhatsApp** : configuration de l'envoi (modèles approuvés Meta).
- **Sauvegarde** : export complet des données en **JSON** et restauration d'une sauvegarde.
- Langue (FR/AR) et thème (clair/sombre).

## 18. Documents imprimables

Reçus de paiement, reçus de frais, bons d'inscription, fiches élèves, relevés de paiements, feuilles de présence, factures de séances libres, fiches de paie enseignants et travailleurs, horaires, graphiques statistiques.

---

# 🇩🇿 النسخة العربية

<div dir="rtl">

## 1. نظرة عامة

يُسيّر **ALTECH SCHOOL** كل الحياة اليومية للمدرسة الخاصة: التسجيلات، جداول التوقيت، الحضور بالبطاقة الإلكترونية RFID، المداخيل، ديون التلاميذ، أجور الأساتذة والعمال، الصندوق، المصاريف، التقارير المالية والتواصل مع الأولياء.

**أهم المزايا**

- تطبيق ويب: يعمل على الحاسوب، اللوحة والهاتف دون تثبيت.
- بيانات محفوظة على الإنترنت بشكل آمن (قاعدة بيانات PostgreSQL / Supabase)، ويمكن لعدة أجهزة العمل في نفس الوقت.
- واجهة **ثنائية اللغة: الفرنسية والعربية** (العربية من اليمين إلى اليسار).
- **وضع فاتح / داكن**.
- **5 أنواع من الحسابات**: المدير، العامل (الاستقبال…)، الأستاذ، التلميذ، الولي.
- كل عملية تحفظ **من قام بها** (الاسم والدور).
- طباعة الوصولات والبطاقات وأوراق الحضور وكشوف الأجور باسم المدرسة وشعارها.

## 2. الحسابات والدخول وصلاحيات الوصول

- الدخول بـ **البريد الإلكتروني وكلمة السر**.
- إنشاء **أول حساب مدير** من صفحة الدخول مباشرة (مرة واحدة فقط).
- حسابات الأساتذة والعمال والتلاميذ والأولياء تُنشأ من داخل التطبيق.
- **صلاحيات مفصلة** لكل عامل: يحدد المدير **شاشة بشاشة وزرًا بزر** ما يمكن للشخص رؤيته وفعله (مثلاً: يستطيع التحصيل دون حذف دفعة).
- تغيير كلمة السر والبريد الإلكتروني.
- كل دور يصل إلى فضائه الخاص بعد الدخول.

## 3. لوحة القيادة

- **شبكة اليوم**: سطر لكل حصة زمنية، عمود لكل قاعة، ولون ثابت لكل جدول توقيت.
- التنقل **اليوم السابق / التالي**، اختيار تاريخ، زر «اليوم»: يمكن تسجيل حضور حصة منسية أو تحضير الغد.
- تقدم اليوم: الحصص المسجلة / المتبقية وعدد التسجيلات.
- **بحث** وفلاتر (القسم، السنة، المادة، الأستاذ) في كل الجداول.
- اختصارات الصندوق: **إيداع، مصروف، سحب**.
- زر **وضعية التلميذ** وزر **تلميذ جديد**.
- **جرس التنبيهات**: الدفعات الجديدة، تنبيهات الحصص الحرة، أجور العمال.

## 4. الأقسام والمستويات

- إنشاء المستويات (ابتدائي، متوسط، ثانوي…) والأقسام/السنوات والفئات.
- عرض، تعديل، حذف.

## 5. جداول التوقيت

- إنشاء جدول باختيار **الأيام** أولاً ثم القسم والمادة والفوج والقاعة والأستاذ.
- **توقيت مختلف لكل يوم** (مثلاً السبت 08:00–10:00 والثلاثاء 14:00–16:00 في نفس الجدول).
- **قاعة مختلفة لكل يوم** مع التحقق الآلي من **توفر القاعات** (القاعة المشغولة تُظهر الجدول الذي يحجزها).
- أسماء القاعات لا تتكرر.
- حصة واحدة يمكن أن تجمع **عدة مستويات** بأفواجها.
- البحث عن الأستاذ بالاسم أو الهاتف.
- حصص **الدروس الحرة**.
- **الأرشفة** بدل الحذف: يبقى الحضور والدفعات والأجور في السجل.
- **طباعة** التوقيت، وعرض أسبوعي.

## 6. الأسعار والاشتراكات

- سعر لكل مادة يطبق على كل أفواجها: **سعر الحصة** و/أو **سعر الشهر** (عدد الحصص في الشهر + سعر الباقة قابل للتعديل).
- الأسعار تقبل **الكسور العشرية**.
- السعر و**حصة المدرسة / حصة الأستاذ** تُضبط لكل جدول توقيت.
- **فترات مجانية / أبواب مفتوحة** (مع خيار «الأساتذة غير مدفوعين»).
- **حقوق التسجيل**: للجميع، لمستوى، لأقسام أو لجداول معينة.
- عرض وتعديل وأرشفة الاشتراك.

## 7. التلاميذ

**بطاقة التلميذ**
- الهوية، **رقم التسجيل**، هاتفان (يمكن لعدة تلاميذ مشاركة نفس الهاتف، كالإخوة)، الصورة، المستوى والسنة، بطاقة **RFID**، حساب الدخول.
- الإنشاء والتعديل في **نفس الشاشة**.
- التسجيل في جدول: التلميذ **يلتحق حيث وصل الفوج** (الشهر M1، M2… ورقم الحصة)، ويُحتسب يوم التسجيل لا الساعة.
- **إلغاء التسجيل** من فوج دون فقدان السجل، مع إمكانية **إعادة التسجيل**.

**حالات الفوترة** (تُضبط لكل جدول توقيت)
- **عادي**.
- **مجاني**.
- **تخفيض** (نسبة أو مبلغ ثابت).
- **ابن/ابنة أستاذ**: تُقتطع الدراسة من أجر الأستاذ أو تُدفع مسبقًا في الشباك.
- **المدرسة فقط**: يدفع التلميذ حصة المدرسة فقط.
- تغيير الحالة مع اختيار مصير الديون الحالية.

**الدفعات**
- الدفع **بالشهر** (M1، M2…) أو **بالحصة**؛ لكل جدول توقيت رصيده الخاص.
- تخفيض، المبلغ المدفوع، **الباقي**؛ الزيادة تبقى رصيدًا مسبقًا.
- اختيار **تاريخ** التحصيل.
- **تصحيح** و**حذف** دفعة (يُصحح الصندوق بنفس الفرق).
- **إعادة طباعة** الوصل، طباعة بطاقة التلميذ و**كشف الدفعات**.
- **مصاريف وديون متنوعة**: كتاب، لباس، خرجة، نقل، أضرار… تُسجل وتُحصل كليًا أو جزئيًا.
- **تسبيقات المدرسة**: يمكن للصندوق أن يسبق حصص التلميذ غير المدفوعة لدفع الأستاذ ثم يُسترجع المبلغ.
- **وضعية التلميذ**: جدول كبير، سطر لكل جدول توقيت (الحالية والسابقة) مع حصص الشهر، المدفوع، الباقي، المتأخرات والرصيد، إضافة إلى المصاريف.
- تنبيهات الديون على البطاقة.
- إرسال **رسائل واتساب** (دين، حصص منتهية/قليلة، تسجيل، رسالة حرة) بالفرنسية أو العربية.
- البحث عن التلميذ بمسح بطاقة RFID.

## 8. الحضور

- **مسح بطاقة RFID** (يعمل من أي شاشة) أو **ورقة حضور** يدوية.
- الحالات: حاضر، غائب، متأخر، **حصة ملغاة**.
- في ورقة حضور الفوج:
  - **تلميذ جديد**، **تلميذ موجود** (بحث بالاسم أو الرقم أو الهاتف)، **تلميذ عابر** (يأتي مرة واحدة دون بطاقة)؛
  - **الكل حاضر** بنقرة واحدة؛
  - **حصة ملغاة للجميع** (لا شيء يُستهلك أو يُدفع)؛
  - **التحصيل** مباشرة، سجل دفعات كل تلميذ وتصحيحها في المكان؛
  - **شريط الديون**: التلاميذ المدينون في هذه المادة (الدراسة، المصاريف، تسبيقات المدرسة) مع الإشارة للديون في جداول أخرى وإمكانية تحصيلها؛
  - إلغاء تسجيل تلميذ.
- حذف حضور أو غياب **يُرجع الحصة** ويلغي حصة الأستاذ غير المدفوعة.
- تلميذ بلا حصص متبقية: يُقبل مع إشارة «للتسوية»؛ اشتراك منتهٍ: البطاقة مرفوضة.
- طباعة **ورقة الحضور**.

## 9. الأساتذة والأجور

- بطاقة الأستاذ مع حساب دخول؛ **أستاذ عابر** (بدون حساب).
- ثلاث طرق للأجر:
  - **شهري** (أجر ثابت)؛
  - **نسبة مئوية** من سعر الحصص؛
  - **بالفوج** (مبلغ ثابت لكل حصة محدد في جدول التوقيت).
- **الأجر شهرًا بشهر**، جدول لكل فوج يُقرأ كورقة الحضور، مع حساب الصافي.
- جدول **«تأخيرات الدفع والحصص الحرة»**: المبالغ التي تُفرج لاحقًا (تلاميذ دفعوا متأخرين، عابرون، حصص حرة).
- حصة الأستاذ تُحجز ما دام التلميذ مدينًا (إلا إذا سبّقت المدرسة).
- **تسبيقات**، **غيابات / اقتطاعات**، **مصاريف** على الأستاذ.
- اقتطاع دراسة أبناء الأستاذ من أجره.
- عرض وتصحيح و**إلغاء** تسديد (يعود كل شيء مستحقًا)، وإعادة الطباعة.
- **كشوف الأجر** وتقارير قابلة للطباعة حسب الفترة (حصة المدرسة لا تظهر أبدًا في كشف الأستاذ).

## 10. العمال

- **مهن** تُنشئها المدرسة بحرية (استقبال، تنظيف، مراقب…).
- الأجر: **يومي، شهري، نصف يوم أو بالساعة**.
- تفعيل **حساب دخول** ومنح **الصلاحيات**.
- **تسبيقات**، **غيابات**، **تسديد** الأجر، **سجل العمل**.
- **التسجيل بالشارة (البادج)**.
- طباعة الوصولات وكشوف الأجر.

## 11. الحصص الحرة

- **حصص حرة جماعية**: الأستاذ، التاريخ، التوقيت، عدد التلاميذ، سعر التلميذ، حصة المدرسة ← حساب آلي للمبلغ الإجمالي وحصة المدرسة وحصة الأستاذ.
- **التلاميذ العابرون**: اسم في كل سطر (أو «عابر»)، وحركة صندوق واحدة للجميع.
- حصة حرة **لتلميذ مسجل** (نقدًا دون المساس بأرصدته).
- **حصص حرة فردية**: لتلميذ أو عدة تلاميذ خارج أي فوج، مع متابعة حصة الأستاذ (مدفوعة / غير مدفوعة) وتنبيه.
- عرض، تعديل، حذف، **إعادة طباعة** الوصل.

## 12. الأولياء

- بطاقات وحسابات الأولياء مرتبطة بأبنائهم.
- إرسال رسائل (واتساب، إشعار).

## 13. الإعلانات

- نشر إعلانات للتلاميذ و/أو الأولياء و/أو الأساتذة؛ تعديل وحذف.

## 14. الصندوق والمصاريف

- **صندوق في الوقت الحقيقي**: إيداعات، سحوبات، مصاريف، مداخيل التلاميذ، أجور الأساتذة والعمال، الحصص الحرة.
- تعديل وحذف أي حركة.
- سجل دفعات التلاميذ داخل الصندوق.
- **المصاريف** حسب الفئة: إدخال، تعديل، حذف.

## 15. التقارير المالية والإحصائيات

- **تقارير** لفترة محددة: مداخيل التلاميذ، الحصص المباعة، التخفيضات، تسديد الديون، الحصص المتبقية، المبالغ الباقية، مداخيل الحصص، مستحقات الأساتذة غير المدفوعة، الهامش الإجمالي، الاشتراكات النشطة، تسبيقات واقتطاعات الأساتذة… كل رقم يُفتح على القائمة التي تكوّنه.
- **إحصائيات**: الإقبال حسب القسم والأستاذ، نسبة الحضور، التأخرات، ذروة الإقبال، تطور عدد التلاميذ، ورسوم بيانية قابلة للطباعة.

## 16. الفضاءات الشخصية

| الفضاء | المحتوى |
|---|---|
| **الأستاذ** | لوحة القيادة، جدول التوقيت، تسجيل الحضور، الأجر، أقسامه وتلاميذه، نشر الواجبات والتمارين، الإعلانات، الملف الشخصي |
| **التلميذ** | الرئيسية، جدول التوقيت، الحضور والغيابات، سجل الدفعات والحصص المتبقية، وثائق الدروس، الإعلانات، الملف الشخصي |
| **الولي** | الرئيسية، أبناؤه (الحصص المتبقية، التسجيلات)، توقيت كل ابن، الدفعات، الإشعارات، الوثائق، الإعلانات، الحساب |

## 17. الإعدادات

- **المؤسسة**: الاسم، الشعار، معلومات الاتصال، المعرفات الجبائية (تظهر في كل الوثائق المطبوعة).
- **الأمان**: تغيير كلمة السر.
- **واتساب**: إعداد الإرسال (نماذج معتمدة من Meta).
- **النسخ الاحتياطي**: تصدير كامل للبيانات بصيغة **JSON** واسترجاع نسخة سابقة.
- اللغة (فرنسية/عربية) والمظهر (فاتح/داكن).

## 18. الوثائق القابلة للطباعة

وصولات الدفع، وصولات المصاريف، وصولات التسجيل، بطاقات التلاميذ، كشوف الدفعات، أوراق الحضور، فواتير الحصص الحرة، كشوف أجور الأساتذة والعمال، جداول التوقيت، الرسوم البيانية.

</div>
