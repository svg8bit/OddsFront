import type { Locale } from "./types.ts";

const NEWS_DESCRIPTIONS: Record<Locale, string> = {
  en: "Verified world news with original sources, multilingual reporting, and related prediction market probabilities.",
  zh: "经核实的全球新闻，附原始来源、多语言报道及相关预测市场概率。",
  ko: "원문 출처, 다국어 보도, 관련 예측시장 확률을 함께 제공하는 검증된 세계 뉴스입니다.",
  vi: "Tin thế giới đã được xác minh, kèm nguồn gốc, bản dịch đa ngôn ngữ và xác suất thị trường dự đoán liên quan.",
  de: "Verifizierte Weltnachrichten mit Originalquellen, mehrsprachiger Berichterstattung und zugehörigen Prognosemarkt-Wahrscheinlichkeiten.",
  es: "Noticias mundiales verificadas con fuentes originales, cobertura multilingüe y probabilidades relacionadas de mercados de predicción.",
  "pt-BR": "Notícias mundiais verificadas com fontes originais, cobertura multilíngue e probabilidades relacionadas dos mercados de previsão.",
  fr: "Actualités mondiales vérifiées avec sources originales, couverture multilingue et probabilités associées des marchés prédictifs.",
  ru: "Проверенные мировые новости с первоисточниками, переводами и связанными вероятностями рынков прогнозов.",
  uk: "Перевірені світові новини з першоджерелами, перекладами та пов’язаними ймовірностями ринків прогнозів.",
  fa: "اخبار تأییدشده جهان همراه با منابع اصلی، گزارش چندزبانه و احتمال‌های مرتبط در بازارهای پیش‌بینی.",
  he: "חדשות עולם מאומתות עם מקורות מקוריים, דיווח רב-לשוני והסתברויות קשורות משוקי חיזוי.",
};

export function newsDescription(locale: Locale): string {
  return NEWS_DESCRIPTIONS[locale];
}
