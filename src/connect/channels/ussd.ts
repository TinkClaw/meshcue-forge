/**
 * MeshCue Connect — USSD Menu Handler
 *
 * Implements the Africa's Talking USSD callback pattern.
 * The `text` field arrives as `*`-delimited selections
 * (e.g., "1*2" means menu 1, option 2).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface USSDResponse {
  /** Text to display to the user. */
  response: string;
  /** When true, the USSD session ends after this response. */
  endSession: boolean;
}

type Language = "en" | "fr" | "sw" | "pt" | "es" | "ar" | "bn" | "hi" | "zh";

// ---------------------------------------------------------------------------
// i18n — lightweight lookup for USSD menu strings
// ---------------------------------------------------------------------------

interface USSDStrings {
  welcome: string;
  reportSymptoms: string;
  requestAppointment: string;
  viewResults: string;
  emergency: string;
  settings: string;
  whatSymptom: string;
  fever: string;
  breathingDifficulty: string;
  diarrhea: string;
  pain: string;
  other: string;
  symptomSent: (clinic: string) => string;
  enterPatientName: string;
  enterPreferredDate: string;
  appointmentRequested: (clinic: string, date: string) => string;
  enterPatientId: string;
  noResultsFound: string;
  resultsDisplay: (spo2: string, temp: string, date: string) => string;
  emergencyAlert: (clinic: string, phone: string) => string;
  changeLanguage: string;
  manageNotifications: string;
  updatePhone: string;
  languageChanged: string;
  notificationsUpdated: string;
  phoneUpdated: string;
  invalidOption: string;
}

const strings: Record<Language, USSDStrings> = {
  en: {
    welcome:
      "Welcome to MeshCue Health\n1. Report symptoms\n2. Request appointment\n3. View test results\n4. Emergency\n5. Settings",
    reportSymptoms: "Report symptoms",
    requestAppointment: "Request appointment",
    viewResults: "View test results",
    emergency: "Emergency",
    settings: "Settings",
    whatSymptom:
      "What symptom?\n1. Fever\n2. Breathing difficulty\n3. Diarrhea\n4. Pain\n5. Other",
    fever: "Fever",
    breathingDifficulty: "Breathing difficulty",
    diarrhea: "Diarrhea",
    pain: "Pain",
    other: "Other",
    symptomSent: (clinic) =>
      `Your report has been sent to ${clinic}. A health worker will contact you.`,
    enterPatientName: "Enter patient name:",
    enterPreferredDate: "Enter preferred date (DD/MM):",
    appointmentRequested: (clinic, date) =>
      `Appointment requested at ${clinic} for ${date}. You will receive confirmation.`,
    enterPatientId: "Enter patient ID or phone number:",
    noResultsFound: "No results found for this ID.",
    resultsDisplay: (spo2, temp, date) =>
      `SpO2: ${spo2}% (normal) | Temp: ${temp}\u00B0C (normal) | Date: ${date}`,
    emergencyAlert: (clinic, phone) =>
      `Emergency alert sent to ${clinic}. Help is on the way. Call ${phone} if urgent.`,
    changeLanguage:
      "Select language:\n1. English\n2. Fran\u00e7ais\n3. Kiswahili\n4. Portugu\u00eas\n5. Espa\u00f1ol",
    manageNotifications:
      "Notifications:\n1. Enable all\n2. Critical only\n3. Disable all",
    updatePhone: "Enter your new phone number:",
    languageChanged: "Language updated successfully.",
    notificationsUpdated: "Notification preferences updated.",
    phoneUpdated: "Phone number updated.",
    invalidOption: "Invalid option. Please try again.",
  },

  fr: {
    welcome:
      "Bienvenue \u00e0 MeshCue Sant\u00e9\n1. Signaler des sympt\u00f4mes\n2. Demander un rendez-vous\n3. Voir les r\u00e9sultats\n4. Urgence\n5. Param\u00e8tres",
    reportSymptoms: "Signaler des sympt\u00f4mes",
    requestAppointment: "Demander un rendez-vous",
    viewResults: "Voir les r\u00e9sultats",
    emergency: "Urgence",
    settings: "Param\u00e8tres",
    whatSymptom:
      "Quel sympt\u00f4me ?\n1. Fi\u00e8vre\n2. Difficult\u00e9 respiratoire\n3. Diarrh\u00e9e\n4. Douleur\n5. Autre",
    fever: "Fi\u00e8vre",
    breathingDifficulty: "Difficult\u00e9 respiratoire",
    diarrhea: "Diarrh\u00e9e",
    pain: "Douleur",
    other: "Autre",
    symptomSent: (clinic) =>
      `Votre rapport a \u00e9t\u00e9 envoy\u00e9 \u00e0 ${clinic}. Un agent de sant\u00e9 vous contactera.`,
    enterPatientName: "Entrez le nom du patient :",
    enterPreferredDate: "Entrez la date souhait\u00e9e (JJ/MM) :",
    appointmentRequested: (clinic, date) =>
      `Rendez-vous demand\u00e9 \u00e0 ${clinic} pour le ${date}. Vous recevrez une confirmation.`,
    enterPatientId: "Entrez l'identifiant ou le num\u00e9ro de t\u00e9l\u00e9phone :",
    noResultsFound: "Aucun r\u00e9sultat trouv\u00e9 pour cet identifiant.",
    resultsDisplay: (spo2, temp, date) =>
      `SpO2 : ${spo2}% (normal) | Temp : ${temp}\u00b0C (normal) | Date : ${date}`,
    emergencyAlert: (clinic, phone) =>
      `Alerte d'urgence envoy\u00e9e \u00e0 ${clinic}. L'aide arrive. Appelez le ${phone} si urgent.`,
    changeLanguage:
      "Choisir la langue :\n1. English\n2. Fran\u00e7ais\n3. Kiswahili\n4. Portugu\u00eas\n5. Espa\u00f1ol",
    manageNotifications:
      "Notifications :\n1. Toutes activ\u00e9es\n2. Critiques uniquement\n3. Toutes d\u00e9sactiv\u00e9es",
    updatePhone: "Entrez votre nouveau num\u00e9ro :",
    languageChanged: "Langue mise \u00e0 jour.",
    notificationsUpdated: "Pr\u00e9f\u00e9rences de notification mises \u00e0 jour.",
    phoneUpdated: "Num\u00e9ro de t\u00e9l\u00e9phone mis \u00e0 jour.",
    invalidOption: "Option invalide. Veuillez r\u00e9essayer.",
  },

  sw: {
    welcome:
      "Karibu MeshCue Afya\n1. Ripoti dalili\n2. Omba miadi\n3. Angalia matokeo\n4. Dharura\n5. Mipangilio",
    reportSymptoms: "Ripoti dalili",
    requestAppointment: "Omba miadi",
    viewResults: "Angalia matokeo",
    emergency: "Dharura",
    settings: "Mipangilio",
    whatSymptom:
      "Dalili gani?\n1. Homa\n2. Ugumu wa kupumua\n3. Kuhara\n4. Maumivu\n5. Nyingine",
    fever: "Homa",
    breathingDifficulty: "Ugumu wa kupumua",
    diarrhea: "Kuhara",
    pain: "Maumivu",
    other: "Nyingine",
    symptomSent: (clinic) =>
      `Ripoti yako imetumwa kwa ${clinic}. Mhudumu wa afya atakuwasiliana nawe.`,
    enterPatientName: "Weka jina la mgonjwa:",
    enterPreferredDate: "Weka tarehe unayopendelea (DD/MM):",
    appointmentRequested: (clinic, date) =>
      `Miadi imeombwa katika ${clinic} kwa ${date}. Utapata uthibitisho.`,
    enterPatientId: "Weka kitambulisho cha mgonjwa au nambari ya simu:",
    noResultsFound: "Hakuna matokeo yaliyopatikana.",
    resultsDisplay: (spo2, temp, date) =>
      `SpO2: ${spo2}% (kawaida) | Joto: ${temp}\u00b0C (kawaida) | Tarehe: ${date}`,
    emergencyAlert: (clinic, phone) =>
      `Tahadhari ya dharura imetumwa kwa ${clinic}. Msaada unakuja. Piga ${phone} kama ni dharura.`,
    changeLanguage:
      "Chagua lugha:\n1. English\n2. Fran\u00e7ais\n3. Kiswahili\n4. Portugu\u00eas\n5. Espa\u00f1ol",
    manageNotifications:
      "Arifa:\n1. Washa zote\n2. Muhimu tu\n3. Zima zote",
    updatePhone: "Weka nambari yako mpya ya simu:",
    languageChanged: "Lugha imesasishwa.",
    notificationsUpdated: "Mapendeleo ya arifa yamebadilishwa.",
    phoneUpdated: "Nambari ya simu imesasishwa.",
    invalidOption: "Chaguo batili. Tafadhali jaribu tena.",
  },

  // Remaining languages fall back to English with translated welcome only,
  // kept concise — extend as needed.
  pt: {
    welcome:
      "Bem-vindo ao MeshCue Sa\u00fade\n1. Relatar sintomas\n2. Solicitar consulta\n3. Ver resultados\n4. Emerg\u00eancia\n5. Configura\u00e7\u00f5es",
    reportSymptoms: "Relatar sintomas",
    requestAppointment: "Solicitar consulta",
    viewResults: "Ver resultados",
    emergency: "Emerg\u00eancia",
    settings: "Configura\u00e7\u00f5es",
    whatSymptom:
      "Qual sintoma?\n1. Febre\n2. Dificuldade respirat\u00f3ria\n3. Diarreia\n4. Dor\n5. Outro",
    fever: "Febre",
    breathingDifficulty: "Dificuldade respirat\u00f3ria",
    diarrhea: "Diarreia",
    pain: "Dor",
    other: "Outro",
    symptomSent: (clinic) =>
      `Seu relat\u00f3rio foi enviado para ${clinic}. Um agente de sa\u00fade entrar\u00e1 em contato.`,
    enterPatientName: "Digite o nome do paciente:",
    enterPreferredDate: "Digite a data preferida (DD/MM):",
    appointmentRequested: (clinic, date) =>
      `Consulta solicitada em ${clinic} para ${date}. Voc\u00ea receber\u00e1 confirma\u00e7\u00e3o.`,
    enterPatientId: "Digite o ID do paciente ou n\u00famero de telefone:",
    noResultsFound: "Nenhum resultado encontrado.",
    resultsDisplay: (spo2, temp, date) =>
      `SpO2: ${spo2}% (normal) | Temp: ${temp}\u00b0C (normal) | Data: ${date}`,
    emergencyAlert: (clinic, phone) =>
      `Alerta de emerg\u00eancia enviado para ${clinic}. Ajuda a caminho. Ligue ${phone} se urgente.`,
    changeLanguage:
      "Selecione idioma:\n1. English\n2. Fran\u00e7ais\n3. Kiswahili\n4. Portugu\u00eas\n5. Espa\u00f1ol",
    manageNotifications:
      "Notifica\u00e7\u00f5es:\n1. Ativar todas\n2. Apenas cr\u00edticas\n3. Desativar todas",
    updatePhone: "Digite seu novo n\u00famero:",
    languageChanged: "Idioma atualizado.",
    notificationsUpdated: "Prefer\u00eancias de notifica\u00e7\u00e3o atualizadas.",
    phoneUpdated: "N\u00famero atualizado.",
    invalidOption: "Op\u00e7\u00e3o inv\u00e1lida. Tente novamente.",
  },

  es: {
    welcome:
      "Bienvenido a MeshCue Salud\n1. Reportar s\u00edntomas\n2. Solicitar cita\n3. Ver resultados\n4. Emergencia\n5. Configuraci\u00f3n",
    reportSymptoms: "Reportar s\u00edntomas",
    requestAppointment: "Solicitar cita",
    viewResults: "Ver resultados",
    emergency: "Emergencia",
    settings: "Configuraci\u00f3n",
    whatSymptom:
      "\u00bfQu\u00e9 s\u00edntoma?\n1. Fiebre\n2. Dificultad respiratoria\n3. Diarrea\n4. Dolor\n5. Otro",
    fever: "Fiebre",
    breathingDifficulty: "Dificultad respiratoria",
    diarrhea: "Diarrea",
    pain: "Dolor",
    other: "Otro",
    symptomSent: (clinic) =>
      `Su reporte fue enviado a ${clinic}. Un agente de salud le contactar\u00e1.`,
    enterPatientName: "Ingrese nombre del paciente:",
    enterPreferredDate: "Ingrese fecha preferida (DD/MM):",
    appointmentRequested: (clinic, date) =>
      `Cita solicitada en ${clinic} para ${date}. Recibir\u00e1 confirmaci\u00f3n.`,
    enterPatientId: "Ingrese ID del paciente o n\u00famero de tel\u00e9fono:",
    noResultsFound: "No se encontraron resultados.",
    resultsDisplay: (spo2, temp, date) =>
      `SpO2: ${spo2}% (normal) | Temp: ${temp}\u00b0C (normal) | Fecha: ${date}`,
    emergencyAlert: (clinic, phone) =>
      `Alerta de emergencia enviada a ${clinic}. La ayuda va en camino. Llame al ${phone} si es urgente.`,
    changeLanguage:
      "Seleccione idioma:\n1. English\n2. Fran\u00e7ais\n3. Kiswahili\n4. Portugu\u00eas\n5. Espa\u00f1ol",
    manageNotifications:
      "Notificaciones:\n1. Activar todas\n2. Solo cr\u00edticas\n3. Desactivar todas",
    updatePhone: "Ingrese su nuevo n\u00famero:",
    languageChanged: "Idioma actualizado.",
    notificationsUpdated: "Preferencias de notificaci\u00f3n actualizadas.",
    phoneUpdated: "N\u00famero actualizado.",
    invalidOption: "Opci\u00f3n inv\u00e1lida. Intente de nuevo.",
  },

  // Arabic, Bengali, Hindi, Chinese — use English as base; translate key phrases
  ar: {
    welcome:
      "\u0645\u0631\u062d\u0628\u0627 \u0628\u0643 \u0641\u064a MeshCue \u0627\u0644\u0635\u062d\u0629\n1. \u0627\u0644\u0625\u0628\u0644\u0627\u063a \u0639\u0646 \u0623\u0639\u0631\u0627\u0636\n2. \u0637\u0644\u0628 \u0645\u0648\u0639\u062f\n3. \u0639\u0631\u0636 \u0627\u0644\u0646\u062a\u0627\u0626\u062c\n4. \u0637\u0648\u0627\u0631\u0626\n5. \u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a",
    reportSymptoms: "\u0627\u0644\u0625\u0628\u0644\u0627\u063a \u0639\u0646 \u0623\u0639\u0631\u0627\u0636",
    requestAppointment: "\u0637\u0644\u0628 \u0645\u0648\u0639\u062f",
    viewResults: "\u0639\u0631\u0636 \u0627\u0644\u0646\u062a\u0627\u0626\u062c",
    emergency: "\u0637\u0648\u0627\u0631\u0626",
    settings: "\u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a",
    whatSymptom:
      "\u0645\u0627 \u0627\u0644\u0639\u0631\u0636\u061f\n1. \u062d\u0645\u0649\n2. \u0635\u0639\u0648\u0628\u0629 \u0641\u064a \u0627\u0644\u062a\u0646\u0641\u0633\n3. \u0625\u0633\u0647\u0627\u0644\n4. \u0623\u0644\u0645\n5. \u0623\u062e\u0631\u0649",
    fever: "\u062d\u0645\u0649",
    breathingDifficulty: "\u0635\u0639\u0648\u0628\u0629 \u0641\u064a \u0627\u0644\u062a\u0646\u0641\u0633",
    diarrhea: "\u0625\u0633\u0647\u0627\u0644",
    pain: "\u0623\u0644\u0645",
    other: "\u0623\u062e\u0631\u0649",
    symptomSent: (clinic) =>
      `\u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u062a\u0642\u0631\u064a\u0631\u0643 \u0625\u0644\u0649 ${clinic}. \u0633\u064a\u062a\u0648\u0627\u0635\u0644 \u0645\u0639\u0643 \u0639\u0627\u0645\u0644 \u0635\u062d\u064a.`,
    enterPatientName: "\u0623\u062f\u062e\u0644 \u0627\u0633\u0645 \u0627\u0644\u0645\u0631\u064a\u0636:",
    enterPreferredDate: "\u0623\u062f\u062e\u0644 \u0627\u0644\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0645\u0641\u0636\u0644 (DD/MM):",
    appointmentRequested: (clinic, date) =>
      `\u062a\u0645 \u0637\u0644\u0628 \u0645\u0648\u0639\u062f \u0641\u064a ${clinic} \u0628\u062a\u0627\u0631\u064a\u062e ${date}. \u0633\u062a\u062a\u0644\u0642\u0649 \u062a\u0623\u0643\u064a\u062f\u0627.`,
    enterPatientId: "\u0623\u062f\u062e\u0644 \u0645\u0639\u0631\u0641 \u0627\u0644\u0645\u0631\u064a\u0636 \u0623\u0648 \u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641:",
    noResultsFound: "\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0646\u062a\u0627\u0626\u062c.",
    resultsDisplay: (spo2, temp, date) =>
      `SpO2: ${spo2}% (\u0637\u0628\u064a\u0639\u064a) | \u062d\u0631\u0627\u0631\u0629: ${temp}\u00b0C (\u0637\u0628\u064a\u0639\u064a) | \u062a\u0627\u0631\u064a\u062e: ${date}`,
    emergencyAlert: (clinic, phone) =>
      `\u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u062a\u0646\u0628\u064a\u0647 \u0637\u0648\u0627\u0631\u0626 \u0625\u0644\u0649 ${clinic}. \u0627\u0644\u0645\u0633\u0627\u0639\u062f\u0629 \u0641\u064a \u0627\u0644\u0637\u0631\u064a\u0642. \u0627\u062a\u0635\u0644 ${phone}.`,
    changeLanguage:
      "\u0627\u062e\u062a\u0631 \u0627\u0644\u0644\u063a\u0629:\n1. English\n2. Fran\u00e7ais\n3. Kiswahili\n4. Portugu\u00eas\n5. Espa\u00f1ol",
    manageNotifications:
      "\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a:\n1. \u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0643\u0644\n2. \u0627\u0644\u0645\u0647\u0645\u0629 \u0641\u0642\u0637\n3. \u062a\u0639\u0637\u064a\u0644 \u0627\u0644\u0643\u0644",
    updatePhone: "\u0623\u062f\u062e\u0644 \u0631\u0642\u0645\u0643 \u0627\u0644\u062c\u062f\u064a\u062f:",
    languageChanged: "\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0644\u063a\u0629.",
    notificationsUpdated: "\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u062a\u0641\u0636\u064a\u0644\u0627\u062a \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a.",
    phoneUpdated: "\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641.",
    invalidOption: "\u062e\u064a\u0627\u0631 \u063a\u064a\u0631 \u0635\u0627\u0644\u062d. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
  },

  bn: {
    welcome:
      "MeshCue \u09b8\u09cd\u09ac\u09be\u09b8\u09cd\u09a5\u09cd\u09af-\u098f \u09b8\u09cd\u09ac\u09be\u0997\u09a4\u09ae\n1. \u09b2\u0995\u09cd\u09b7\u09a3 \u099c\u09be\u09a8\u09be\u09a8\n2. \u0985\u09cd\u09af\u09be\u09aa\u09df\u09c7\u09a8\u09cd\u099f\u09ae\u09c7\u09a8\u09cd\u099f\n3. \u09ab\u09b2\u09be\u09ab\u09b2 \u09a6\u09c7\u0996\u09c1\u09a8\n4. \u099c\u09b0\u09c1\u09b0\u09bf\n5. \u09b8\u09c7\u099f\u09bf\u0982\u09b8",
    reportSymptoms: "\u09b2\u0995\u09cd\u09b7\u09a3 \u099c\u09be\u09a8\u09be\u09a8",
    requestAppointment: "\u0985\u09cd\u09af\u09be\u09aa\u09df\u09c7\u09a8\u09cd\u099f\u09ae\u09c7\u09a8\u09cd\u099f",
    viewResults: "\u09ab\u09b2\u09be\u09ab\u09b2 \u09a6\u09c7\u0996\u09c1\u09a8",
    emergency: "\u099c\u09b0\u09c1\u09b0\u09bf",
    settings: "\u09b8\u09c7\u099f\u09bf\u0982\u09b8",
    whatSymptom:
      "\u0995\u09bf \u09b2\u0995\u09cd\u09b7\u09a3?\n1. \u099c\u09cd\u09ac\u09b0\n2. \u09b6\u09cd\u09ac\u09be\u09b8\u0995\u09b7\u09cd\u099f\n3. \u09a1\u09be\u09df\u09b0\u09bf\u09df\u09be\n4. \u09ac\u09cd\u09af\u09a5\u09be\n5. \u0985\u09a8\u09cd\u09af\u09be\u09a8\u09cd\u09af",
    fever: "\u099c\u09cd\u09ac\u09b0",
    breathingDifficulty: "\u09b6\u09cd\u09ac\u09be\u09b8\u0995\u09b7\u09cd\u099f",
    diarrhea: "\u09a1\u09be\u09df\u09b0\u09bf\u09df\u09be",
    pain: "\u09ac\u09cd\u09af\u09a5\u09be",
    other: "\u0985\u09a8\u09cd\u09af\u09be\u09a8\u09cd\u09af",
    symptomSent: (clinic) =>
      `\u0986\u09aa\u09a8\u09be\u09b0 \u09b0\u09bf\u09aa\u09cb\u09b0\u09cd\u099f ${clinic}-\u098f \u09aa\u09be\u09a0\u09be\u09a8\u09cb \u09b9\u09df\u09c7\u099b\u09c7\u0964 \u098f\u0995\u099c\u09a8 \u09b8\u09cd\u09ac\u09be\u09b8\u09cd\u09a5\u09cd\u09af\u0995\u09b0\u09cd\u09ae\u09c0 \u09af\u09cb\u0997\u09be\u09af\u09cb\u0997 \u0995\u09b0\u09ac\u09c7\u09a8\u0964`,
    enterPatientName: "\u09b0\u09cb\u0997\u09c0\u09b0 \u09a8\u09be\u09ae \u09b2\u09bf\u0996\u09c1\u09a8:",
    enterPreferredDate: "\u09aa\u099b\u09a8\u09cd\u09a6\u09b8\u0987 \u09a4\u09be\u09b0\u09bf\u0996 (DD/MM):",
    appointmentRequested: (clinic, date) =>
      `${clinic}-\u098f ${date} \u09a4\u09be\u09b0\u09bf\u0996\u09c7 \u0985\u09cd\u09af\u09be\u09aa\u09df\u09c7\u09a8\u09cd\u099f\u09ae\u09c7\u09a8\u09cd\u099f \u0985\u09a8\u09c1\u09b0\u09cb\u09a7 \u0995\u09b0\u09be \u09b9\u09df\u09c7\u099b\u09c7\u0964`,
    enterPatientId: "\u09b0\u09cb\u0997\u09c0\u09b0 ID \u09ac\u09be \u09ab\u09cb\u09a8 \u09a8\u09ae\u09cd\u09ac\u09b0 \u09b2\u09bf\u0996\u09c1\u09a8:",
    noResultsFound: "\u0995\u09cb\u09a8\u09cb \u09ab\u09b2\u09be\u09ab\u09b2 \u09aa\u09be\u0993\u09df\u09be \u09af\u09be\u09df\u09a8\u09bf\u0964",
    resultsDisplay: (spo2, temp, date) =>
      `SpO2: ${spo2}% (\u09b8\u09cd\u09ac\u09be\u09ad\u09be\u09ac\u09bf\u0995) | \u09a4\u09be\u09aa: ${temp}\u00b0C (\u09b8\u09cd\u09ac\u09be\u09ad\u09be\u09ac\u09bf\u0995) | \u09a4\u09be\u09b0\u09bf\u0996: ${date}`,
    emergencyAlert: (clinic, phone) =>
      `${clinic}-\u098f \u099c\u09b0\u09c1\u09b0\u09bf \u09b8\u09a4\u09b0\u09cd\u0995\u09a4\u09be \u09aa\u09be\u09a0\u09be\u09a8\u09cb \u09b9\u09df\u09c7\u099b\u09c7\u0964 \u09b8\u09be\u09b9\u09be\u09af\u09cd\u09af \u0986\u09b8\u099b\u09c7\u0964 \u0995\u09b2 \u0995\u09b0\u09c1\u09a8 ${phone}\u0964`,
    changeLanguage:
      "\u09ad\u09be\u09b7\u09be \u09a8\u09bf\u09b0\u09cd\u09ac\u09be\u099a\u09a8 \u0995\u09b0\u09c1\u09a8:\n1. English\n2. Fran\u00e7ais\n3. Kiswahili\n4. Portugu\u00eas\n5. Espa\u00f1ol",
    manageNotifications:
      "\u09ac\u09bf\u099c\u09cd\u09a3\u09aa\u09cd\u09a4\u09bf:\n1. \u09b8\u09ac \u09b8\u0995\u09cd\u09b0\u09bf\u09df\n2. \u09b6\u09c1\u09a7\u09c1 \u0997\u09c1\u09b0\u09c1\u09a4\u09cd\u09ac\u09aa\u09c2\u09b0\u09cd\u09a3\n3. \u09b8\u09ac \u09ac\u09a8\u09cd\u09a7",
    updatePhone: "\u0986\u09aa\u09a8\u09be\u09b0 \u09a8\u09a4\u09c1\u09a8 \u09a8\u09ae\u09cd\u09ac\u09b0 \u09b2\u09bf\u0996\u09c1\u09a8:",
    languageChanged: "\u09ad\u09be\u09b7\u09be \u0986\u09aa\u09a1\u09c7\u099f \u09b9\u09df\u09c7\u099b\u09c7\u0964",
    notificationsUpdated: "\u09ac\u09bf\u099c\u09cd\u09a3\u09aa\u09cd\u09a4\u09bf \u09aa\u09cd\u09b0\u09c1\u09ab\u09b0\u09c7\u09a8\u09cd\u09b8 \u0986\u09aa\u09a1\u09c7\u099f \u09b9\u09df\u09c7\u099b\u09c7\u0964",
    phoneUpdated: "\u09ab\u09cb\u09a8 \u09a8\u09ae\u09cd\u09ac\u09b0 \u0986\u09aa\u09a1\u09c7\u099f \u09b9\u09df\u09c7\u099b\u09c7\u0964",
    invalidOption: "\u0985\u09ac\u09c8\u09a7 \u09ac\u09bf\u0995\u09b2\u09cd\u09aa\u0964 \u0986\u09ac\u09be\u09b0 \u099a\u09c7\u09b7\u09cd\u099f\u09be \u0995\u09b0\u09c1\u09a8\u0964",
  },

  hi: {
    welcome:
      "MeshCue \u0938\u094d\u0935\u093e\u0938\u094d\u0925\u094d\u092f \u092e\u0947\u0902 \u0906\u092a\u0915\u093e \u0938\u094d\u0935\u093e\u0917\u0924 \u0939\u0948\n1. \u0932\u0915\u094d\u0937\u0923 \u0930\u093f\u092a\u094b\u0930\u094d\u099f \u0915\u0930\u0947\u0902\n2. \u0905\u092a\u0949\u0907\u0902\u099f\u092e\u0947\u0902\u099f\n3. \u092a\u0930\u093f\u0923\u093e\u092e \u0926\u0947\u0916\u0947\u0902\n4. \u0906\u092a\u093e\u0924\u0915\u093e\u0932\n5. \u0938\u0947\u099f\u093f\u0902\u0917\u094d\u0938",
    reportSymptoms: "\u0932\u0915\u094d\u0937\u0923 \u0930\u093f\u092a\u094b\u0930\u094d\u099f \u0915\u0930\u0947\u0902",
    requestAppointment: "\u0905\u092a\u0949\u0907\u0902\u099f\u092e\u0947\u0902\u099f",
    viewResults: "\u092a\u0930\u093f\u0923\u093e\u092e \u0926\u0947\u0916\u0947\u0902",
    emergency: "\u0906\u092a\u093e\u0924\u0915\u093e\u0932",
    settings: "\u0938\u0947\u099f\u093f\u0902\u0917\u094d\u0938",
    whatSymptom:
      "\u0915\u094c\u0928 \u0938\u093e \u0932\u0915\u094d\u0937\u0923?\n1. \u092c\u0941\u0916\u093e\u0930\n2. \u0938\u093e\u0902\u0938 \u0932\u0947\u0928\u0947 \u092e\u0947\u0902 \u0924\u0915\u0932\u0940\u092b\n3. \u0926\u0938\u094d\u0924\n4. \u0926\u0930\u094d\u0926\n5. \u0905\u0928\u094d\u092f",
    fever: "\u092c\u0941\u0916\u093e\u0930",
    breathingDifficulty: "\u0938\u093e\u0902\u0938 \u0932\u0947\u0928\u0947 \u092e\u0947\u0902 \u0924\u0915\u0932\u0940\u092b",
    diarrhea: "\u0926\u0938\u094d\u0924",
    pain: "\u0926\u0930\u094d\u0926",
    other: "\u0905\u0928\u094d\u092f",
    symptomSent: (clinic) =>
      `\u0906\u092a\u0915\u0940 \u0930\u093f\u092a\u094b\u0930\u094d\u099f ${clinic} \u0915\u094b \u092d\u0947\u091c\u0940 \u0917\u0908 \u0939\u0948\u0964 \u0938\u094d\u0935\u093e\u0938\u094d\u0925\u094d\u092f\u0915\u0930\u094d\u092e\u0940 \u0938\u0902\u092a\u0930\u094d\u0915 \u0915\u0930\u0947\u0902\u0917\u0947\u0964`,
    enterPatientName: "\u0930\u094b\u0917\u0940 \u0915\u093e \u0928\u093e\u092e \u0926\u0930\u094d\u091c \u0915\u0930\u0947\u0902:",
    enterPreferredDate: "\u092a\u0938\u0902\u0926\u0940\u0926\u093e \u0924\u093e\u0930\u0940\u0916 (DD/MM):",
    appointmentRequested: (clinic, date) =>
      `${clinic} \u092e\u0947\u0902 ${date} \u0915\u094b \u0905\u092a\u0949\u0907\u0902\u099f\u092e\u0947\u0902\u099f \u0905\u0928\u0941\u0930\u094b\u0927 \u0915\u093f\u092f\u093e \u0917\u092f\u093e\u0964`,
    enterPatientId: "\u0930\u094b\u0917\u0940 ID \u092f\u093e \u092b\u094b\u0928 \u0928\u0902\u092c\u0930 \u0926\u0930\u094d\u091c \u0915\u0930\u0947\u0902:",
    noResultsFound: "\u0915\u094b\u0908 \u092a\u0930\u093f\u0923\u093e\u092e \u0928\u0939\u0940\u0902 \u092e\u093f\u0932\u093e\u0964",
    resultsDisplay: (spo2, temp, date) =>
      `SpO2: ${spo2}% (\u0938\u093e\u092e\u093e\u0928\u094d\u092f) | \u0924\u093e\u092a\u092e\u093e\u0928: ${temp}\u00b0C (\u0938\u093e\u092e\u093e\u0928\u094d\u092f) | \u0924\u093e\u0930\u0940\u0916: ${date}`,
    emergencyAlert: (clinic, phone) =>
      `${clinic} \u0915\u094b \u0906\u092a\u093e\u0924\u0915\u093e\u0932\u0940\u0928 \u0938\u0942\u091a\u0928\u093e \u092d\u0947\u091c\u0940 \u0917\u0908\u0964 \u092e\u0926\u0926 \u0906 \u0930\u0939\u0940 \u0939\u0948\u0964 \u0915\u0949\u0932 \u0915\u0930\u0947\u0902 ${phone}\u0964`,
    changeLanguage:
      "\u092d\u093e\u0937\u093e \u091a\u0941\u0928\u0947\u0902:\n1. English\n2. Fran\u00e7ais\n3. Kiswahili\n4. Portugu\u00eas\n5. Espa\u00f1ol",
    manageNotifications:
      "\u0938\u0942\u091a\u0928\u093e\u090f\u0902:\n1. \u0938\u092d\u0940 \u0938\u0915\u094d\u0930\u093f\u092f\n2. \u0915\u0947\u0935\u0932 \u0917\u0902\u092d\u0940\u0930\n3. \u0938\u092d\u0940 \u092c\u0902\u0926",
    updatePhone: "\u0905\u092a\u0928\u093e \u0928\u092f\u093e \u0928\u0902\u092c\u0930 \u0926\u0930\u094d\u091c \u0915\u0930\u0947\u0902:",
    languageChanged: "\u092d\u093e\u0937\u093e \u0905\u092a\u0921\u0947\u099f \u0939\u094b \u0917\u0908\u0964",
    notificationsUpdated: "\u0938\u0942\u091a\u0928\u093e \u092a\u094d\u0930\u093e\u0925\u092e\u093f\u0915\u0924\u093e\u090f\u0902 \u0905\u092a\u0921\u0947\u099f \u0939\u094b \u0917\u0908\u0902\u0964",
    phoneUpdated: "\u092b\u094b\u0928 \u0928\u0902\u092c\u0930 \u0905\u092a\u0921\u0947\u099f \u0939\u094b \u0917\u092f\u093e\u0964",
    invalidOption: "\u0905\u092e\u093e\u0928\u094d\u092f \u0935\u093f\u0915\u0932\u094d\u092a\u0964 \u092a\u0941\u0928\u0903 \u092a\u094d\u0930\u092f\u093e\u0938 \u0915\u0930\u0947\u0902\u0964",
  },

  zh: {
    welcome:
      "\u6b22\u8fce\u4f7f\u7528 MeshCue \u5065\u5eb7\n1. \u62a5\u544a\u75c7\u72b6\n2. \u9884\u7ea6\n3. \u67e5\u770b\u7ed3\u679c\n4. \u7d27\u6025\u60c5\u51b5\n5. \u8bbe\u7f6e",
    reportSymptoms: "\u62a5\u544a\u75c7\u72b6",
    requestAppointment: "\u9884\u7ea6",
    viewResults: "\u67e5\u770b\u7ed3\u679c",
    emergency: "\u7d27\u6025\u60c5\u51b5",
    settings: "\u8bbe\u7f6e",
    whatSymptom:
      "\u4ec0\u4e48\u75c7\u72b6\uff1f\n1. \u53d1\u70e7\n2. \u547c\u5438\u56f0\u96be\n3. \u8179\u6cfb\n4. \u75bc\u75db\n5. \u5176\u4ed6",
    fever: "\u53d1\u70e7",
    breathingDifficulty: "\u547c\u5438\u56f0\u96be",
    diarrhea: "\u8179\u6cfb",
    pain: "\u75bc\u75db",
    other: "\u5176\u4ed6",
    symptomSent: (clinic) =>
      `\u60a8\u7684\u62a5\u544a\u5df2\u53d1\u9001\u81f3${clinic}\u3002\u5065\u5eb7\u5de5\u4f5c\u8005\u5c06\u4e0e\u60a8\u8054\u7cfb\u3002`,
    enterPatientName: "\u8bf7\u8f93\u5165\u60a3\u8005\u59d3\u540d:",
    enterPreferredDate: "\u8bf7\u8f93\u5165\u9996\u9009\u65e5\u671f (DD/MM):",
    appointmentRequested: (clinic, date) =>
      `\u5df2\u5728${clinic}\u9884\u7ea6${date}\u3002\u60a8\u5c06\u6536\u5230\u786e\u8ba4\u3002`,
    enterPatientId: "\u8bf7\u8f93\u5165\u60a3\u8005ID\u6216\u7535\u8bdd\u53f7\u7801:",
    noResultsFound: "\u672a\u627e\u5230\u7ed3\u679c\u3002",
    resultsDisplay: (spo2, temp, date) =>
      `SpO2: ${spo2}% (\u6b63\u5e38) | \u4f53\u6e29: ${temp}\u00b0C (\u6b63\u5e38) | \u65e5\u671f: ${date}`,
    emergencyAlert: (clinic, phone) =>
      `\u7d27\u6025\u8b66\u62a5\u5df2\u53d1\u9001\u81f3${clinic}\u3002\u6551\u63f4\u6b63\u5728\u8d76\u6765\u3002\u7d27\u6025\u8bf7\u62e8${phone}\u3002`,
    changeLanguage:
      "\u9009\u62e9\u8bed\u8a00:\n1. English\n2. Fran\u00e7ais\n3. Kiswahili\n4. Portugu\u00eas\n5. Espa\u00f1ol",
    manageNotifications:
      "\u901a\u77e5:\n1. \u5168\u90e8\u5f00\u542f\n2. \u4ec5\u91cd\u8981\n3. \u5168\u90e8\u5173\u95ed",
    updatePhone: "\u8bf7\u8f93\u5165\u65b0\u7535\u8bdd\u53f7\u7801:",
    languageChanged: "\u8bed\u8a00\u5df2\u66f4\u65b0\u3002",
    notificationsUpdated: "\u901a\u77e5\u504f\u597d\u5df2\u66f4\u65b0\u3002",
    phoneUpdated: "\u7535\u8bdd\u53f7\u7801\u5df2\u66f4\u65b0\u3002",
    invalidOption: "\u65e0\u6548\u9009\u9879\u3002\u8bf7\u91cd\u8bd5\u3002",
  },
};

function t(lang: Language): USSDStrings {
  return strings[lang] ?? strings.en;
}

// ---------------------------------------------------------------------------
// Session store (in-memory; swap for Redis/DB in production)
// ---------------------------------------------------------------------------

interface SessionState {
  phone: string;
  language: Language;
  data: Record<string, string>;
}

const sessions = new Map<string, SessionState>();

// ---------------------------------------------------------------------------
// Stub services — replace with real DB/API calls
// ---------------------------------------------------------------------------

function getClinicForPhone(_phone: string): string {
  return "Kigali Health Center";
}

function getClinicPhone(_phone: string): string {
  return "+250788000000";
}

async function lookupTestResults(
  _patientIdOrPhone: string,
): Promise<{ spo2: string; temp: string; date: string } | null> {
  // Stub: return sample data. In production, query the MeshCue data store.
  return { spo2: "96", temp: "37.1", date: "25/03/2026" };
}

async function sendEmergencyAlert(
  _phone: string,
  _clinic: string,
): Promise<void> {
  // Stub: In production, trigger real alert via SMS/voice provider.
}

// ---------------------------------------------------------------------------
// Language selection helper
// ---------------------------------------------------------------------------

const languageMap: Record<string, Language> = {
  "1": "en",
  "2": "fr",
  "3": "sw",
  "4": "pt",
  "5": "es",
};

// ---------------------------------------------------------------------------
// USSD Handler
// ---------------------------------------------------------------------------

export class USSDHandler {
  /**
   * Handle an incoming USSD request (Africa's Talking callback format).
   *
   * @param sessionId  Unique session identifier from AT.
   * @param phone      MSISDN of the user (e.g., "+254711000000").
   * @param text       `*`-separated selections, empty string for first request.
   */
  async handleRequest(
    sessionId: string,
    phone: string,
    text: string,
  ): Promise<USSDResponse> {
    // Initialise session if new
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        phone,
        language: "en",
        data: {},
      });
    }

    const session = sessions.get(sessionId)!;
    const lang = session.language;
    const s = t(lang);

    // Parse AT text field: "" → root, "1" → level 1, "1*2" → level 1 then 2
    const parts = text === "" ? [] : text.split("*").map((p) => p.trim());

    try {
      return await this.route(session, sessionId, parts, s);
    } catch {
      // Cleanup on unexpected error
      sessions.delete(sessionId);
      return { response: s.invalidOption, endSession: true };
    }
  }

  private async route(
    session: SessionState,
    sessionId: string,
    parts: string[],
    s: USSDStrings,
  ): Promise<USSDResponse> {
    // Root menu
    if (parts.length === 0) {
      return { response: s.welcome, endSession: false };
    }

    const menu = parts[0];

    switch (menu) {
      // ----- 1. Report symptoms -----
      case "1":
        return this.handleSymptoms(session, sessionId, parts, s);

      // ----- 2. Request appointment -----
      case "2":
        return this.handleAppointment(session, sessionId, parts, s);

      // ----- 3. View test results -----
      case "3":
        return this.handleResults(session, sessionId, parts, s);

      // ----- 4. Emergency -----
      case "4":
        return this.handleEmergency(session, sessionId, s);

      // ----- 5. Settings -----
      case "5":
        return this.handleSettings(session, sessionId, parts, s);

      default:
        return { response: s.invalidOption, endSession: true };
    }
  }

  // --- Symptom reporting ---
  private handleSymptoms(
    session: SessionState,
    sessionId: string,
    parts: string[],
    s: USSDStrings,
  ): USSDResponse {
    if (parts.length === 1) {
      return { response: s.whatSymptom, endSession: false };
    }

    // User selected a symptom
    const symptomMap: Record<string, string> = {
      "1": s.fever,
      "2": s.breathingDifficulty,
      "3": s.diarrhea,
      "4": s.pain,
      "5": s.other,
    };

    const symptom = symptomMap[parts[1]];
    if (!symptom) {
      return { response: s.invalidOption, endSession: true };
    }

    const clinic = getClinicForPhone(session.phone);
    sessions.delete(sessionId);
    return { response: s.symptomSent(clinic), endSession: true };
  }

  // --- Appointment booking ---
  private handleAppointment(
    session: SessionState,
    sessionId: string,
    parts: string[],
    s: USSDStrings,
  ): USSDResponse {
    // Step 1: Ask for patient name
    if (parts.length === 1) {
      return { response: s.enterPatientName, endSession: false };
    }

    // Step 2: Name entered, ask for date
    if (parts.length === 2) {
      session.data.patientName = parts[1];
      return { response: s.enterPreferredDate, endSession: false };
    }

    // Step 3: Date entered, confirm
    const date = parts[2];
    const clinic = getClinicForPhone(session.phone);
    sessions.delete(sessionId);
    return {
      response: s.appointmentRequested(clinic, date),
      endSession: true,
    };
  }

  // --- Test results ---
  private async handleResults(
    session: SessionState,
    sessionId: string,
    parts: string[],
    s: USSDStrings,
  ): Promise<USSDResponse> {
    // Step 1: Ask for patient ID
    if (parts.length === 1) {
      return { response: s.enterPatientId, endSession: false };
    }

    // Step 2: Look up results
    const patientIdOrPhone = parts[1];
    const results = await lookupTestResults(patientIdOrPhone);
    sessions.delete(sessionId);

    if (!results) {
      return { response: s.noResultsFound, endSession: true };
    }

    return {
      response: s.resultsDisplay(results.spo2, results.temp, results.date),
      endSession: true,
    };
  }

  // --- Emergency ---
  private async handleEmergency(
    session: SessionState,
    sessionId: string,
    s: USSDStrings,
  ): Promise<USSDResponse> {
    const clinic = getClinicForPhone(session.phone);
    const phone = getClinicPhone(session.phone);
    await sendEmergencyAlert(session.phone, clinic);
    sessions.delete(sessionId);
    return { response: s.emergencyAlert(clinic, phone), endSession: true };
  }

  // --- Settings ---
  private handleSettings(
    session: SessionState,
    sessionId: string,
    parts: string[],
    s: USSDStrings,
  ): USSDResponse {
    // Sub-menu
    if (parts.length === 1) {
      return {
        response: `${s.settings}\n1. ${s.changeLanguage.split("\n")[0]}\n2. ${s.manageNotifications.split("\n")[0]}\n3. ${s.updatePhone.split(":")[0]}`,
        endSession: false,
      };
    }

    const setting = parts[1];

    switch (setting) {
      // Change language
      case "1":
        if (parts.length === 2) {
          return { response: s.changeLanguage, endSession: false };
        }
        {
          const newLang = languageMap[parts[2]];
          if (newLang) {
            session.language = newLang;
          }
          sessions.delete(sessionId);
          return {
            response: t(session.language).languageChanged,
            endSession: true,
          };
        }

      // Manage notifications
      case "2":
        if (parts.length === 2) {
          return { response: s.manageNotifications, endSession: false };
        }
        sessions.delete(sessionId);
        return { response: s.notificationsUpdated, endSession: true };

      // Update phone
      case "3":
        if (parts.length === 2) {
          return { response: s.updatePhone, endSession: false };
        }
        sessions.delete(sessionId);
        return { response: s.phoneUpdated, endSession: true };

      default:
        return { response: s.invalidOption, endSession: true };
    }
  }
}

/**
 * Factory function for creating a USSD handler instance.
 */
export function createUSSDHandler(): USSDHandler {
  return new USSDHandler();
}
