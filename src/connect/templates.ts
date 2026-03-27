/**
 * MeshCue Connect — Message Templates
 *
 * Multi-language message templates for health alerts, reminders,
 * and patient communication. Covers 9 languages matching the
 * i18n/medical.ts language set.
 */

type Language = "en" | "fr" | "pt" | "es" | "sw" | "ar" | "bn" | "hi" | "zh";

type TemplateStrings = Record<Language, string>;

// ─── Template Registry ───────────────────────────────────────

const templates: Record<string, TemplateStrings> = {
  // ── SpO2 ────────────────────────────────────────────────────
  spo2_critical: {
    en: "⚠️ EMERGENCY: {name}'s oxygen is {value}%. Go to {clinic} NOW.",
    fr: "⚠️ URGENCE : L'oxygène de {name} est à {value}%. Allez à {clinic} MAINTENANT.",
    pt: "⚠️ EMERGÊNCIA: O oxigénio de {name} está em {value}%. Vá a {clinic} AGORA.",
    es: "⚠️ EMERGENCIA: El oxígeno de {name} es {value}%. Vaya a {clinic} AHORA.",
    sw: "⚠️ DHARURA: Oksijeni ya {name} ni {value}%. Nenda {clinic} SASA.",
    ar: "⚠️ طوارئ: مستوى الأكسجين لـ {name} هو {value}%. اذهب إلى {clinic} الآن.",
    bn: "⚠️ জরুরি: {name}-এর অক্সিজেন {value}%। এখনই {clinic}-এ যান।",
    hi: "⚠️ आपातकाल: {name} का ऑक्सीजन {value}% है। अभी {clinic} जाएं।",
    zh: "⚠️ 紧急：{name}的血氧为{value}%。立即前往{clinic}。",
  },

  spo2_warning: {
    en: "{name}'s oxygen is {value}%. Visit {clinic} tomorrow.",
    fr: "L'oxygène de {name} est à {value}%. Visitez {clinic} demain.",
    pt: "O oxigénio de {name} está em {value}%. Visite {clinic} amanhã.",
    es: "El oxígeno de {name} es {value}%. Visite {clinic} mañana.",
    sw: "Oksijeni ya {name} ni {value}%. Tembelea {clinic} kesho.",
    ar: "مستوى الأكسجين لـ {name} هو {value}%. قم بزيارة {clinic} غداً.",
    bn: "{name}-এর অক্সিজেন {value}%। আগামীকাল {clinic}-এ যান।",
    hi: "{name} का ऑक्सीजन {value}% है। कल {clinic} जाएं।",
    zh: "{name}的血氧为{value}%。明天前往{clinic}就诊。",
  },

  spo2_normal: {
    en: "{name}'s oxygen is {value}%. Normal. Next check: {date}.",
    fr: "L'oxygène de {name} est à {value}%. Normal. Prochain contrôle : {date}.",
    pt: "O oxigénio de {name} está em {value}%. Normal. Próximo exame: {date}.",
    es: "El oxígeno de {name} es {value}%. Normal. Próxima revisión: {date}.",
    sw: "Oksijeni ya {name} ni {value}%. Kawaida. Ukaguzi ujao: {date}.",
    ar: "مستوى الأكسجين لـ {name} هو {value}%. طبيعي. الفحص القادم: {date}.",
    bn: "{name}-এর অক্সিজেন {value}%। স্বাভাবিক। পরবর্তী পরীক্ষা: {date}।",
    hi: "{name} का ऑक्सीजन {value}% है। सामान्य। अगली जांच: {date}।",
    zh: "{name}的血氧为{value}%。正常。下次检查：{date}。",
  },

  // ── Temperature ─────────────────────────────────────────────
  temp_critical: {
    en: "⚠️ EMERGENCY: {name} has {value}°C fever. Go to {clinic} NOW.",
    fr: "⚠️ URGENCE : {name} a {value}°C de fièvre. Allez à {clinic} MAINTENANT.",
    pt: "⚠️ EMERGÊNCIA: {name} tem febre de {value}°C. Vá a {clinic} AGORA.",
    es: "⚠️ EMERGENCIA: {name} tiene {value}°C de fiebre. Vaya a {clinic} AHORA.",
    sw: "⚠️ DHARURA: {name} ana homa ya {value}°C. Nenda {clinic} SASA.",
    ar: "⚠️ طوارئ: {name} لديه حرارة {value}°م. اذهب إلى {clinic} الآن.",
    bn: "⚠️ জরুরি: {name}-এর জ্বর {value}°C। এখনই {clinic}-এ যান।",
    hi: "⚠️ आपातकाल: {name} को {value}°C बुखार है। अभी {clinic} जाएं।",
    zh: "⚠️ 紧急：{name}体温{value}°C。立即前往{clinic}。",
  },

  temp_warning: {
    en: "{name} has {value}°C fever. Give paracetamol. Visit clinic if no improvement in 24h.",
    fr: "{name} a {value}°C de fièvre. Donnez du paracétamol. Consultez si pas d'amélioration en 24h.",
    pt: "{name} tem febre de {value}°C. Dê paracetamol. Visite a clínica se não melhorar em 24h.",
    es: "{name} tiene {value}°C de fiebre. Dé paracetamol. Visite la clínica si no mejora en 24h.",
    sw: "{name} ana homa ya {value}°C. Mpe paracetamol. Tembelea kliniki ikiwa hakuna mabadiliko kwa saa 24.",
    ar: "{name} لديه حرارة {value}°م. أعطه باراسيتامول. زُر العيادة إذا لم يتحسن خلال 24 ساعة.",
    bn: "{name}-এর জ্বর {value}°C। প্যারাসিটামল দিন। ২৪ ঘণ্টায় উন্নতি না হলে ক্লিনিকে যান।",
    hi: "{name} को {value}°C बुखार है। पैरासिटामोल दें। 24 घंटे में सुधार न हो तो क्लिनिक जाएं।",
    zh: "{name}体温{value}°C。服用扑热息痛。如24小时内未好转，请就医。",
  },

  // ── Blood Pressure ──────────────────────────────────────────
  bp_critical: {
    en: "⚠️ Blood pressure {value} is dangerous. Go to {clinic} NOW.",
    fr: "⚠️ Tension artérielle {value} est dangereuse. Allez à {clinic} MAINTENANT.",
    pt: "⚠️ Pressão arterial {value} é perigosa. Vá a {clinic} AGORA.",
    es: "⚠️ Presión arterial {value} es peligrosa. Vaya a {clinic} AHORA.",
    sw: "⚠️ Shinikizo la damu {value} ni hatari. Nenda {clinic} SASA.",
    ar: "⚠️ ضغط الدم {value} خطير. اذهب إلى {clinic} الآن.",
    bn: "⚠️ রক্তচাপ {value} বিপজ্জনক। এখনই {clinic}-এ যান।",
    hi: "⚠️ रक्तचाप {value} खतरनाक है। अभी {clinic} जाएं।",
    zh: "⚠️ 血压{value}危险。立即前往{clinic}。",
  },

  // ── Heart Rate ──────────────────────────────────────────────
  hr_critical: {
    en: "⚠️ EMERGENCY: {name}'s heart rate is {value} bpm. Go to {clinic} NOW.",
    fr: "⚠️ URGENCE : Le rythme cardiaque de {name} est {value} bpm. Allez à {clinic} MAINTENANT.",
    pt: "⚠️ EMERGÊNCIA: A frequência cardíaca de {name} é {value} bpm. Vá a {clinic} AGORA.",
    es: "⚠️ EMERGENCIA: La frecuencia cardíaca de {name} es {value} lpm. Vaya a {clinic} AHORA.",
    sw: "⚠️ DHARURA: Mapigo ya moyo ya {name} ni {value} bpm. Nenda {clinic} SASA.",
    ar: "⚠️ طوارئ: معدل نبض {name} هو {value} نبضة/دقيقة. اذهب إلى {clinic} الآن.",
    bn: "⚠️ জরুরি: {name}-এর হৃদস্পন্দন {value} bpm। এখনই {clinic}-এ যান।",
    hi: "⚠️ आपातकाल: {name} की हृदय गति {value} bpm है। अभी {clinic} जाएं।",
    zh: "⚠️ 紧急：{name}的心率为{value} bpm。立即前往{clinic}。",
  },

  // ── Appointments & Reminders ────────────────────────────────
  appointment_reminder: {
    en: "Reminder: {name} has appointment at {clinic} on {date} at {time}.",
    fr: "Rappel : {name} a rendez-vous à {clinic} le {date} à {time}.",
    pt: "Lembrete: {name} tem consulta em {clinic} em {date} às {time}.",
    es: "Recordatorio: {name} tiene cita en {clinic} el {date} a las {time}.",
    sw: "Kumbusho: {name} ana miadi katika {clinic} tarehe {date} saa {time}.",
    ar: "تذكير: لدى {name} موعد في {clinic} بتاريخ {date} الساعة {time}.",
    bn: "স্মারক: {name}-এর {clinic}-এ {date} তারিখে {time}-এ অ্যাপয়েন্টমেন্ট আছে।",
    hi: "अनुस्मारक: {name} की {clinic} में {date} को {time} पर अपॉइंटमेंट है।",
    zh: "提醒：{name}在{clinic}的预约时间为{date} {time}。",
  },

  medication_reminder: {
    en: "Time to give {medication} to {name}. Dose: {dose}.",
    fr: "Il est temps de donner {medication} à {name}. Dose : {dose}.",
    pt: "Hora de dar {medication} a {name}. Dose: {dose}.",
    es: "Hora de dar {medication} a {name}. Dosis: {dose}.",
    sw: "Wakati wa kumpa {name} {medication}. Dozi: {dose}.",
    ar: "حان وقت إعطاء {medication} لـ {name}. الجرعة: {dose}.",
    bn: "{name}-কে {medication} দেওয়ার সময়। ডোজ: {dose}।",
    hi: "{name} को {medication} देने का समय। खुराक: {dose}।",
    zh: "该给{name}服用{medication}了。剂量：{dose}。",
  },

  result_ready: {
    en: "Test results for {name} are ready. Visit {clinic} or reply RESULT.",
    fr: "Les résultats de {name} sont prêts. Visitez {clinic} ou répondez RESULT.",
    pt: "Os resultados de {name} estão prontos. Visite {clinic} ou responda RESULT.",
    es: "Los resultados de {name} están listos. Visite {clinic} o responda RESULT.",
    sw: "Matokeo ya {name} yako tayari. Tembelea {clinic} au jibu MATOKEO.",
    ar: "نتائج فحوصات {name} جاهزة. زُر {clinic} أو أرسل RESULT.",
    bn: "{name}-এর পরীক্ষার ফলাফল প্রস্তুত। {clinic}-এ যান অথবা RESULT উত্তর দিন।",
    hi: "{name} के परीक्षण परिणाम तैयार हैं। {clinic} जाएं या RESULT उत्तर दें।",
    zh: "{name}的检查结果已出。请前往{clinic}或回复RESULT。",
  },

  follow_up: {
    en: "How is {name}? Reply OK if fine, or HELP if you need assistance.",
    fr: "Comment va {name} ? Répondez OK si tout va bien, ou AIDE si besoin.",
    pt: "Como está {name}? Responda OK se estiver bem, ou AJUDA se precisar.",
    es: "¿Cómo está {name}? Responda OK si está bien, o AYUDA si necesita asistencia.",
    sw: "Hali ya {name}? Jibu SAWA ikiwa ni sawa, au MSAADA ukihitaji usaidizi.",
    ar: "كيف حال {name}؟ أرسل OK إذا كان بخير، أو HELP إذا تحتاج مساعدة.",
    bn: "{name} কেমন আছেন? ভালো থাকলে OK উত্তর দিন, সাহায্য লাগলে HELP।",
    hi: "{name} कैसे हैं? ठीक हों तो OK, मदद चाहिए तो HELP उत्तर दें।",
    zh: "{name}怎么样？好的话回复OK，需要帮助回复HELP。",
  },

  // ── Family Notifications ────────────────────────────────────
  family_update: {
    en: "{name} is at {clinic}. Status: {status}. Next update: {date}.",
    fr: "{name} est à {clinic}. État : {status}. Prochaine mise à jour : {date}.",
    pt: "{name} está em {clinic}. Estado: {status}. Próxima atualização: {date}.",
    es: "{name} está en {clinic}. Estado: {status}. Próxima actualización: {date}.",
    sw: "{name} yuko {clinic}. Hali: {status}. Taarifa ijayo: {date}.",
    ar: "{name} في {clinic}. الحالة: {status}. التحديث القادم: {date}.",
    bn: "{name} {clinic}-এ আছেন। অবস্থা: {status}। পরবর্তী আপডেট: {date}।",
    hi: "{name} {clinic} में हैं। स्थिति: {status}। अगला अपडेट: {date}।",
    zh: "{name}在{clinic}。状态：{status}。下次更新：{date}。",
  },

  family_emergency: {
    en: "⚠️ {name} needs emergency care at {clinic}. Contact: {phone}.",
    fr: "⚠️ {name} a besoin de soins d'urgence à {clinic}. Contact : {phone}.",
    pt: "⚠️ {name} precisa de cuidados de emergência em {clinic}. Contacto: {phone}.",
    es: "⚠️ {name} necesita atención de emergencia en {clinic}. Contacto: {phone}.",
    sw: "⚠️ {name} anahitaji huduma ya dharura katika {clinic}. Wasiliana: {phone}.",
    ar: "⚠️ {name} يحتاج رعاية طارئة في {clinic}. للتواصل: {phone}.",
    bn: "⚠️ {name}-এর {clinic}-এ জরুরি যত্ন দরকার। যোগাযোগ: {phone}।",
    hi: "⚠️ {name} को {clinic} में आपातकालीन देखभाल चाहिए। संपर्क: {phone}।",
    zh: "⚠️ {name}需要在{clinic}接受急诊。联系电话：{phone}。",
  },

  // ── Consent ─────────────────────────────────────────────────
  consent_request: {
    en: "MeshCue health alerts for {name}. Reply YES to receive or NO to decline.",
    fr: "Alertes santé MeshCue pour {name}. Répondez OUI pour accepter ou NON pour refuser.",
    pt: "Alertas de saúde MeshCue para {name}. Responda SIM para aceitar ou NÃO para recusar.",
    es: "Alertas de salud MeshCue para {name}. Responda SÍ para aceptar o NO para rechazar.",
    sw: "Tahadhari za afya MeshCue kwa {name}. Jibu NDIYO kupokea au HAPANA kukataa.",
    ar: "تنبيهات صحية من MeshCue لـ {name}. أرسل نعم للموافقة أو لا للرفض.",
    bn: "{name}-এর জন্য MeshCue স্বাস্থ্য সতর্কতা। পেতে হ্যাঁ বা প্রত্যাখ্যান করতে না উত্তর দিন।",
    hi: "{name} के लिए MeshCue स्वास्थ्य अलर्ट। प्राप्त करने के लिए हाँ या अस्वीकार के लिए नहीं उत्तर दें।",
    zh: "MeshCue为{name}提供健康提醒。回复YES接收或NO拒绝。",
  },

  opt_out_confirm: {
    en: "You have been unsubscribed. Reply START to re-subscribe.",
    fr: "Vous avez été désinscrit. Répondez START pour vous réinscrire.",
    pt: "Foi removido da lista. Responda START para voltar a subscrever.",
    es: "Ha sido dado de baja. Responda START para volver a suscribirse.",
    sw: "Umejitoa. Jibu START kujisajili tena.",
    ar: "تم إلغاء اشتراكك. أرسل START لإعادة الاشتراك.",
    bn: "আপনি সদস্যতা বাতিল করেছেন। পুনরায় সদস্যতার জন্য START উত্তর দিন।",
    hi: "आपकी सदस्यता रद्द कर दी गई है। फिर से सदस्यता के लिए START उत्तर दें।",
    zh: "您已退订。回复START重新订阅。",
  },

  // ── CHW (Community Health Worker) ───────────────────────────
  chw_daily_summary: {
    en: "Today: {visits} visits, {screenings} screenings, {referrals} referrals. {alerts} alerts.",
    fr: "Aujourd'hui : {visits} visites, {screenings} dépistages, {referrals} références. {alerts} alertes.",
    pt: "Hoje: {visits} visitas, {screenings} rastreios, {referrals} encaminhamentos. {alerts} alertas.",
    es: "Hoy: {visits} visitas, {screenings} tamizajes, {referrals} referencias. {alerts} alertas.",
    sw: "Leo: ziara {visits}, uchunguzi {screenings}, rufaa {referrals}. tahadhari {alerts}.",
    ar: "اليوم: {visits} زيارات، {screenings} فحوصات، {referrals} إحالات. {alerts} تنبيهات.",
    bn: "আজ: {visits} পরিদর্শন, {screenings} স্ক্রিনিং, {referrals} রেফারেল। {alerts} সতর্কতা।",
    hi: "आज: {visits} दौरे, {screenings} जांच, {referrals} रेफरल। {alerts} अलर्ट।",
    zh: "今日：{visits}次访问，{screenings}次筛查，{referrals}次转诊。{alerts}条警报。",
  },

  danger_signs: {
    en: "Watch for: fast breathing, high fever, not eating, unusual sleepiness. If any: go to clinic or reply HELP.",
    fr: "Surveillez : respiration rapide, forte fièvre, refus de manger, somnolence inhabituelle. Si oui : allez à la clinique ou répondez AIDE.",
    pt: "Fique atento a: respiração rápida, febre alta, não comer, sonolência incomum. Se houver: vá à clínica ou responda AJUDA.",
    es: "Vigile: respiración rápida, fiebre alta, no come, somnolencia inusual. Si hay alguno: vaya a la clínica o responda AYUDA.",
    sw: "Angalia: kupumua haraka, homa kali, kutokula, usingizi usio wa kawaida. Ikiwa yoyote: nenda kliniki au jibu MSAADA.",
    ar: "انتبه لـ: تنفس سريع، حمى شديدة، عدم الأكل، نعاس غير عادي. إذا ظهر أي منها: اذهب للعيادة أو أرسل HELP.",
    bn: "লক্ষ্য রাখুন: দ্রুত শ্বাস, উচ্চ জ্বর, না খাওয়া, অস্বাভাবিক ঘুম। যেকোনো একটি হলে: ক্লিনিকে যান বা HELP উত্তর দিন।",
    hi: "ध्यान दें: तेज सांस, तेज बुखार, खाना न खाना, असामान्य नींद। कोई भी हो तो: क्लिनिक जाएं या HELP उत्तर दें।",
    zh: "注意：呼吸急促、高烧、不进食、异常嗜睡。如有任何症状：去诊所或回复HELP。",
  },

  // ── Symptom report acknowledgment ──────────────────────────
  symptom_received: {
    en: "Your symptom report has been sent to the nurse. You will be contacted soon.",
    fr: "Votre rapport de symptômes a été envoyé à l'infirmier. Vous serez contacté bientôt.",
    pt: "O seu relatório de sintomas foi enviado ao enfermeiro. Será contactado em breve.",
    es: "Su reporte de síntomas ha sido enviado a la enfermera. Será contactado pronto.",
    sw: "Taarifa yako ya dalili imetumwa kwa muuguzi. Utawasiliana nawe hivi karibuni.",
    ar: "تم إرسال تقرير الأعراض الخاص بك إلى الممرض. سيتم التواصل معك قريباً.",
    bn: "আপনার উপসর্গ রিপোর্ট নার্সকে পাঠানো হয়েছে। শীঘ্রই যোগাযোগ করা হবে।",
    hi: "आपकी लक्षण रिपोर्ट नर्स को भेज दी गई है। जल्द ही संपर्क किया जाएगा।",
    zh: "您的症状报告已发送给护士。将很快与您联系。",
  },

  // ── Incoming keyword responses ─────────────────────────────
  appointment_ack: {
    en: "Appointment request received. A nurse will confirm your appointment time.",
    fr: "Demande de rendez-vous reçue. Un infirmier confirmera votre heure de rendez-vous.",
    pt: "Pedido de consulta recebido. Um enfermeiro confirmará o horário da sua consulta.",
    es: "Solicitud de cita recibida. Una enfermera confirmará su horario de cita.",
    sw: "Ombi la miadi limepokelewa. Muuguzi atathibitisha wakati wa miadi yako.",
    ar: "تم استلام طلب الموعد. ستقوم ممرضة بتأكيد موعدك.",
    bn: "অ্যাপয়েন্টমেন্ট অনুরোধ পাওয়া গেছে। একজন নার্স আপনার সময় নিশ্চিত করবেন।",
    hi: "अपॉइंटमेंट अनुरोध प्राप्त हुआ। एक नर्स आपकी अपॉइंटमेंट का समय पुष्टि करेगी।",
    zh: "预约请求已收到。护士将确认您的预约时间。",
  },
};

// ─── Template Renderer ───────────────────────────────────────

/**
 * Renders a named template with the given data in the specified language.
 *
 * Template variables use `{key}` syntax. If a variable is not found in data,
 * it remains as-is. Falls back to English if the language is not available.
 *
 * @param name    - Template name (e.g., "spo2_critical")
 * @param data    - Key-value pairs for template interpolation
 * @param language - ISO language code
 * @returns Rendered message string
 */
export function renderTemplate(
  name: string,
  data: Record<string, string | number>,
  language: string
): string {
  const template = templates[name];
  if (!template) {
    throw new Error(`Unknown template: ${name}`);
  }

  const lang = language as Language;
  // Fall back to English if the requested language is not available
  const raw = template[lang] ?? template.en;

  // Replace {key} placeholders with data values
  return raw.replace(/\{(\w+)\}/g, (match, key: string) => {
    const val = data[key];
    return val !== undefined ? String(val) : match;
  });
}

/**
 * Returns list of all available template names.
 */
export function getTemplateNames(): string[] {
  return Object.keys(templates);
}

/**
 * Returns list of all supported languages.
 */
export function getSupportedLanguages(): Language[] {
  return ["en", "fr", "pt", "es", "sw", "ar", "bn", "hi", "zh"];
}
