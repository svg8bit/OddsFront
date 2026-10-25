import type { Locale } from "./types";
const keys=["Odds","Large BUY","Gold","Silver","Copper","Oil"];
const labels:Record<Locale,string[]>={
 en:keys,ru:["Вероятность","Крупная покупка","Золото","Серебро","Медь","Нефть"]};
export function marketLabel(locale:Locale,text:string){const index=keys.indexOf(text);return index<0?text:labels[locale][index];}
