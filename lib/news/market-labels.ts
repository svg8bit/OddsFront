import type { Locale } from "./types";
const keys=["Odds","Large BUY","Gold","Silver","Copper","Oil"];
const labels:Record<Locale,string[]>={
 en:keys,ru:["Вероятность","Крупная покупка","Золото","Серебро","Медь","Нефть"],uk:["Ймовірність","Велика купівля","Золото","Срібло","Мідь","Нафта"],
 zh:["概率","大额买入","黄金","白银","铜","石油"],ko:["확률","대규모 매수","금","은","구리","석유"],vi:["Xác suất","Mua lớn","Vàng","Bạc","Đồng","Dầu"],
 de:["Wahrscheinlichkeit","Großkauf","Gold","Silber","Kupfer","Öl"],es:["Probabilidad","Gran compra","Oro","Plata","Cobre","Petróleo"],"pt-BR":["Probabilidade","Grande compra","Ouro","Prata","Cobre","Petróleo"],fr:["Probabilité","Achat important","Or","Argent","Cuivre","Pétrole"],
 fa:["احتمال","خرید بزرگ","طلا","نقره","مس","نفت"],he:["הסתברות","רכישה גדולה","זהב","כסף","נחושת","נפט"]};
export function marketLabel(locale:Locale,text:string){const index=keys.indexOf(text);return index<0?text:labels[locale][index];}
