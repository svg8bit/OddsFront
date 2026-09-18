import type { Locale, NewsArticle } from "./types.ts";

export const NEWS_CATEGORIES = ["politics", "geopolitics", "conflicts", "economy", "technology", "health", "climate", "crypto", "internet", "culture", "world"] as const;
export type NewsCategory = typeof NEWS_CATEGORIES[number];

const LABELS: Record<Locale, readonly string[]> = {
  en: ["Politics", "Geopolitics", "Conflicts", "Economy", "Technology & AI", "Health", "Climate & disasters", "Crypto", "Internet & memes", "Culture", "World"],
  ru: ["Политика", "Геополитика", "Конфликты", "Экономика", "Технологии и ИИ", "Здоровье", "Климат и катастрофы", "Крипто", "Интернет и мемы", "Культура", "Мир"],
  uk: ["Політика", "Геополітика", "Конфлікти", "Економіка", "Технології та ШІ", "Здоров’я", "Клімат і катастрофи", "Крипто", "Інтернет і меми", "Культура", "Світ"],
  zh: ["政治", "地缘政治", "冲突", "经济", "科技与人工智能", "健康", "气候与灾害", "加密货币", "互联网与迷因", "文化", "世界"],
  ko: ["정치", "지정학", "분쟁", "경제", "기술·AI", "건강", "기후·재난", "암호화폐", "인터넷·밈", "문화", "세계"],
  vi: ["Chính trị", "Địa chính trị", "Xung đột", "Kinh tế", "Công nghệ & AI", "Sức khỏe", "Khí hậu & thiên tai", "Crypto", "Internet & meme", "Văn hóa", "Thế giới"],
  de: ["Politik", "Geopolitik", "Konflikte", "Wirtschaft", "Technologie & KI", "Gesundheit", "Klima & Katastrophen", "Krypto", "Internet & Memes", "Kultur", "Welt"],
  es: ["Política", "Geopolítica", "Conflictos", "Economía", "Tecnología e IA", "Salud", "Clima y desastres", "Cripto", "Internet y memes", "Cultura", "Mundo"],
  "pt-BR": ["Política", "Geopolítica", "Conflitos", "Economia", "Tecnologia e IA", "Saúde", "Clima e desastres", "Cripto", "Internet e memes", "Cultura", "Mundo"],
  fr: ["Politique", "Géopolitique", "Conflits", "Économie", "Technologie & IA", "Santé", "Climat & catastrophes", "Crypto", "Internet & mèmes", "Culture", "Monde"],
  fa: ["سیاست", "ژئوپلیتیک", "درگیری‌ها", "اقتصاد", "فناوری و هوش مصنوعی", "سلامت", "اقلیم و بلایا", "رمزارز", "اینترنت و میم‌ها", "فرهنگ", "جهان"],
  he: ["פוליטיקה", "גאופוליטיקה", "סכסוכים", "כלכלה", "טכנולוגיה ובינה מלאכותית", "בריאות", "אקלים ואסונות", "קריפטו", "אינטרנט וממים", "תרבות", "עולם"],
};
const ALL: Record<Locale,string>={en:"All news",ru:"Все новости",uk:"Усі новини",zh:"全部新闻",ko:"전체 뉴스",vi:"Tất cả tin tức",de:"Alle Nachrichten",es:"Todas las noticias","pt-BR":"Todas as notícias",fr:"Toutes les actualités",fa:"همه اخبار",he:"כל החדשות"};
const NAV: Record<Locale,string>={en:"News categories",ru:"Категории новостей",uk:"Категорії новин",zh:"新闻分类",ko:"뉴스 분야",vi:"Chuyên mục tin tức",de:"Nachrichtenkategorien",es:"Categorías de noticias","pt-BR":"Categorias de notícias",fr:"Rubriques",fa:"دسته‌بندی اخبار",he:"קטגוריות חדשות"};
export function isNewsCategory(value:string):value is NewsCategory{return (NEWS_CATEGORIES as readonly string[]).includes(value);}
export function categoryLabel(category:NewsCategory,locale:Locale):string{return LABELS[locale][NEWS_CATEGORIES.indexOf(category)];}
export function allNewsLabel(locale:Locale):string{return ALL[locale];}
export function newsCategoriesLabel(locale:Locale):string{return NAV[locale];}

export function articleCategory(article:Pick<NewsArticle,"title"|"topics">):NewsCategory{
  const text=`${article.title} ${article.topics.join(" ")}`.toLowerCase();
  if(/\b(?:virus|viral|outbreak|epidemic|pandemic|disease|vaccine|vaccin|who\b|health|hospital|infection|pathogen|flu\b|covid|mpox)\b/.test(text))return "health";
  if(/\b(?:artificial intelligence|\bai\b|openai|anthropic|google|apple|microsoft|nvidia|robot|chip|semiconductor|software|technology|tech\b|spaceflight|spacex|cyber)\b/.test(text))return "technology";
  if(/\b(?:bitcoin|ethereum|crypto|blockchain|stablecoin|defi|solana|token|memecoin|exchange)\b/.test(text))return "crypto";
  if(/\b(?:meme|viral|social media|tiktok|youtube|instagram|reddit|x\.com|twitter|influencer|internet trend)\b/.test(text))return "internet";
  if(/\b(?:film|movie|music|artist|actor|celebrity|festival|streaming|culture|gaming|game\b|entertainment)\b/.test(text))return "culture";
  if(/\b(?:climate|wildfire|hurricane|typhoon|flood|earthquake|eruption|heatwave|storm|disaster|emissions?)\b/.test(text))return "climate";
  if(/\b(?:inflation|gdp|economy|economic|interest rate|central bank|federal reserve|ecb|tariff|trade|jobs|unemployment|recession|oil price|markets?)\b/.test(text))return "economy";
  if(/\b(?:airstrike|strike|invasion|ceasefire|war\b|military|missile|drone|attack|shelling|troops|hostage|armed conflict)\b/.test(text))return "conflicts";
  if(/\b(?:election|vote|voting|parliament|president|prime minister|government|coalition|court|legislation|bill\b|campaign|politic)\b/.test(text))return "politics";
  if(/\b(?:diplomac|sanction|treaty|summit|foreign minister|nato|united nations|border|territor|geopolit|bilateral|embassy)\b/.test(text))return "geopolitics";
  return "world";
}
