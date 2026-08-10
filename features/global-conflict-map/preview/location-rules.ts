import type {
  PreviewCoordinate,
  PreviewEvidenceStatus,
  PreviewGeographyKind,
  PreviewTone,
} from "@/features/global-conflict-map/preview/types";
import {
  resolveCountryAnchor,
  resolveCountryParticipants,
} from "@/features/global-conflict-map/preview/country-anchors";

export interface ConflictLocationRule {
  id: string;
  label: string;
  region: string;
  coordinates: PreviewCoordinate;
  countryCodes: string[];
  countryFeatureIds: string[];
  tone: PreviewTone;
  evidenceStatus: Exclude<PreviewEvidenceStatus, "illustrative-fixture">;
  matcher: RegExp;
}

interface PlaceDefinition {
  id: string;
  label: string;
  coordinates: PreviewCoordinate;
  matcher: RegExp;
}

const ukrainePlaces: PlaceDefinition[] = [
  {
    id: "kostiantynivka",
    label: "Kostiantynivka",
    coordinates: [37.71, 48.53],
    matcher: /kost(?:i|y)antynivka/i,
  },
  {
    id: "lyman",
    label: "Lyman",
    coordinates: [37.8168, 48.9801],
    matcher: /\blyman\b/i,
  },
  {
    id: "stepnohirsk",
    label: "Stepnohirsk",
    coordinates: [35.356, 47.5869],
    matcher: /stepnohirsk/i,
  },
  {
    id: "kupiansk-vuzlovyi",
    label: "Kupiansk-Vuzlovyi",
    coordinates: [37.6439, 49.6599],
    matcher: /kupiansk-vuzlovyi/i,
  },
  {
    id: "kupiansk",
    label: "Kupiansk",
    coordinates: [37.6142, 49.7133],
    matcher: /\bkupiansk\b/i,
  },
  {
    id: "vovchansk",
    label: "Vovchansk",
    coordinates: [36.937, 50.2929],
    matcher: /vovchansk/i,
  },
  {
    id: "sumy",
    label: "Sumy",
    coordinates: [34.8028, 50.912],
    matcher: /\bsumy\b/i,
  },
  {
    id: "sloviansk",
    label: "Sloviansk",
    coordinates: [37.6058, 48.8523],
    matcher: /sloviansk/i,
  },
  {
    id: "orikhiv",
    label: "Orikhiv",
    coordinates: [35.7855, 47.5754],
    matcher: /orikhiv/i,
  },
  {
    id: "mala-tokmachka",
    label: "Mala Tokmachka",
    coordinates: [35.8968, 47.5327],
    matcher: /mala tokmachka/i,
  },
  {
    id: "bilytske",
    label: "Bilytske",
    coordinates: [37.1765, 48.4078],
    matcher: /bilytske/i,
  },
  {
    id: "borova",
    label: "Borova",
    coordinates: [37.6253, 49.3799],
    matcher: /\bborova\b/i,
  },
  {
    id: "dobropillia",
    label: "Dobropillia",
    coordinates: [37.0903, 48.4683],
    matcher: /dobropillia/i,
  },
  {
    id: "mykhailivka",
    label: "Mykhailivka",
    coordinates: [37.3526, 48.1422],
    matcher: /mykhailivka/i,
  },
  {
    id: "havrylivka",
    label: "Havrylivka",
    coordinates: [36.805, 48.8539],
    matcher: /havrylivka/i,
  },
  {
    id: "sofiivka",
    label: "Sofiivka",
    coordinates: [37.5136, 48.7411],
    matcher: /sofiivka/i,
  },
  {
    id: "khatnie",
    label: "Khatnie",
    coordinates: [37.5633, 50.12],
    matcher: /khatnie/i,
  },
  {
    id: "drobysheve",
    label: "Drobysheve",
    coordinates: [37.7341, 49.0435],
    matcher: /drobysheve/i,
  },
  {
    id: "malokaterynivka",
    label: "Malokaterynivka",
    coordinates: [35.2573, 47.656],
    matcher: /malokaterynivka/i,
  },
  {
    id: "uspensivka",
    label: "Uspenivka",
    coordinates: [37.2291, 47.9173],
    matcher: /uspenivka/i,
  },
  {
    id: "rai-oleksandrivka",
    label: "Rai-Oleksandrivka",
    coordinates: [37.8517, 48.8105],
    matcher: /rai-oleksandrivka/i,
  },
  {
    id: "toretske",
    label: "Toretske",
    coordinates: [37.365, 48.4961],
    matcher: /toretske/i,
  },
  {
    id: "chasiv-yar",
    label: "Chasiv Yar",
    coordinates: [37.8576, 48.5881],
    matcher: /chasiv yar/i,
  },
  {
    id: "ternuvate",
    label: "Ternuvate",
    coordinates: [36.1268, 47.8293],
    matcher: /ternuvate/i,
  },
  {
    id: "rodynske",
    label: "Rodynske",
    coordinates: [37.2034, 48.354],
    matcher: /rodynske/i,
  },
  {
    id: "huliaipilske",
    label: "Huliaipilske",
    coordinates: [36.0629, 47.6127],
    matcher: /huliaipilske/i,
  },
  {
    id: "stavky",
    label: "Stavky",
    coordinates: [37.9361, 48.2521],
    matcher: /\bstavky\b/i,
  },
  {
    id: "dovha-balka",
    label: "Dovha Balka",
    coordinates: [37.6064, 48.4925],
    matcher: /dovha balka/i,
  },
  {
    id: "oleksiievo-druzhkivka",
    label: "Oleksiievo-Druzhkivka",
    coordinates: [37.6045, 48.5786],
    matcher: /oleksiievo-druzhkivka/i,
  },
  {
    id: "myropillia",
    label: "Myropillia",
    coordinates: [35.247, 51.0273],
    matcher: /myropillia/i,
  },
  {
    id: "hryshyne",
    label: "Hryshyne",
    coordinates: [37.0798, 48.3294],
    matcher: /hryshyne/i,
  },
  {
    id: "myrnohrad",
    label: "Myrnohrad",
    coordinates: [37.2591, 48.3079],
    matcher: /myrnohrad/i,
  },
  {
    id: "kucheriv-yar",
    label: "Kucheriv Yar",
    coordinates: [37.2791, 48.5099],
    matcher: /kucheriv yar/i,
  },
  {
    id: "vodianske",
    label: "Vodianske",
    coordinates: [37.1049, 48.4107],
    matcher: /vodianske/i,
  },
  {
    id: "novodmytrivka",
    label: "Novodmytrivka",
    coordinates: [37.2229, 48.087],
    matcher: /novodmytrivka/i,
  },
  {
    id: "verkhnia-tersa",
    label: "Verkhnia Tersa",
    coordinates: [36.0818, 47.6958],
    matcher: /verkhnia tersa/i,
  },
  {
    id: "kindrativka",
    label: "Kindrativka",
    coordinates: [34.7715, 51.142],
    matcher: /kindrativka/i,
  },
  {
    id: "crimea",
    label: "Crimea",
    coordinates: [34.1, 45.15],
    matcher: /crimea|crimean/i,
  },
  {
    id: "donetsk",
    label: "Donetsk Oblast",
    coordinates: [37.781, 47.9213],
    matcher: /donetsk/i,
  },
];

const ukraineLocationRules: ConflictLocationRule[] = ukrainePlaces.map(
  (place) => ({
    ...place,
    region: "Eastern Europe",
    countryCodes: ["UA"],
    countryFeatureIds: ["UKR"],
    tone: "violet",
    evidenceStatus: "exact-place",
  }),
);

export const CONFLICT_LOCATION_RULES: ConflictLocationRule[] = [
  ...ukraineLocationRules,
  {
    id: "kharg-island",
    label: "Kharg Island",
    region: "Persian Gulf",
    coordinates: [50.32, 29.24],
    countryCodes: ["IR"],
    countryFeatureIds: ["IRN"],
    tone: "red",
    evidenceStatus: "exact-place",
    matcher: /kharg island/i,
  },
  {
    id: "farsi-island",
    label: "Farsi Island",
    region: "Persian Gulf",
    coordinates: [50.17, 27.99],
    countryCodes: ["IR"],
    countryFeatureIds: ["IRN"],
    tone: "red",
    evidenceStatus: "exact-place",
    matcher: /farsi island/i,
  },
  {
    id: "hengam-island",
    label: "Hengam Island",
    region: "Persian Gulf",
    coordinates: [55.89, 26.67],
    countryCodes: ["IR"],
    countryFeatureIds: ["IRN"],
    tone: "red",
    evidenceStatus: "exact-place",
    matcher: /hengam island/i,
  },
  {
    id: "abu-musa-island",
    label: "Abu Musa Island",
    region: "Persian Gulf",
    coordinates: [55.03, 25.88],
    countryCodes: ["IR"],
    countryFeatureIds: ["IRN"],
    tone: "red",
    evidenceStatus: "exact-place",
    matcher: /abu musa island/i,
  },
  {
    id: "hormuz-island",
    label: "Hormuz Island",
    region: "Persian Gulf",
    coordinates: [56.46, 27.06],
    countryCodes: ["IR"],
    countryFeatureIds: ["IRN"],
    tone: "red",
    evidenceStatus: "exact-place",
    matcher: /hormuz island/i,
  },
  {
    id: "strait-of-hormuz",
    label: "Strait of Hormuz",
    region: "Persian Gulf",
    coordinates: [56.42, 26.56],
    countryCodes: ["IR", "OM"],
    countryFeatureIds: ["IRN", "OMN"],
    tone: "red",
    evidenceStatus: "regional-anchor",
    matcher: /strait of hormuz|\bhormuz\b/i,
  },
  {
    id: "iran-nuclear-sites",
    label: "Central Iran nuclear sites",
    region: "Middle East",
    coordinates: [51.73, 33.51],
    countryCodes: ["IR"],
    countryFeatureIds: ["IRN"],
    tone: "red",
    evidenceStatus: "regional-anchor",
    matcher: /isfahan|fordow|natanz/i,
  },
  {
    id: "beirut",
    label: "Beirut",
    region: "Levant",
    coordinates: [35.5018, 33.8938],
    countryCodes: ["LB"],
    countryFeatureIds: ["LBN"],
    tone: "red",
    evidenceStatus: "exact-place",
    matcher: /beirut/i,
  },
  {
    id: "nabatieh",
    label: "Nabatieh",
    region: "Levant",
    coordinates: [35.483, 33.378],
    countryCodes: ["LB"],
    countryFeatureIds: ["LBN"],
    tone: "red",
    evidenceStatus: "exact-place",
    matcher: /nabatieh|choukine/i,
  },
  {
    id: "tyre",
    label: "Tyre",
    region: "Levant",
    coordinates: [35.196, 33.271],
    countryCodes: ["LB"],
    countryFeatureIds: ["LBN"],
    tone: "red",
    evidenceStatus: "exact-place",
    matcher: /\btyre\b/i,
  },
  {
    id: "litani-river",
    label: "Litani River",
    region: "Levant",
    coordinates: [35.42, 33.38],
    countryCodes: ["LB"],
    countryFeatureIds: ["LBN"],
    tone: "red",
    evidenceStatus: "regional-anchor",
    matcher: /litani/i,
  },
  {
    id: "gaza",
    label: "Gaza Strip",
    region: "Levant",
    coordinates: [34.46, 31.43],
    countryCodes: ["PS", "IL"],
    countryFeatureIds: ["PSE", "ISR"],
    tone: "red",
    evidenceStatus: "regional-anchor",
    matcher: /gaza|hamas/i,
  },
  {
    id: "west-bank",
    label: "West Bank",
    region: "Levant",
    coordinates: [35.2, 31.95],
    countryCodes: ["PS", "IL"],
    countryFeatureIds: ["PSE", "ISR"],
    tone: "red",
    evidenceStatus: "regional-anchor",
    matcher: /west bank|palestin/i,
  },
  {
    id: "lebanon",
    label: "Lebanon",
    region: "Levant",
    coordinates: [35.84, 33.86],
    countryCodes: ["LB"],
    countryFeatureIds: ["LBN"],
    tone: "red",
    evidenceStatus: "country-anchor",
    matcher: /lebanon|hezbollah/i,
  },
  {
    id: "taiwan-strait",
    label: "Taiwan Strait",
    region: "East Asia",
    coordinates: [120.52, 24.1],
    countryCodes: ["TW", "CN"],
    countryFeatureIds: ["TWN", "CHN"],
    tone: "violet",
    evidenceStatus: "regional-anchor",
    matcher: /taiwan/i,
  },
  {
    id: "korean-dmz",
    label: "Korean DMZ",
    region: "East Asia",
    coordinates: [127.12, 38.05],
    countryCodes: ["KP", "KR"],
    countryFeatureIds: ["PRK", "KOR"],
    tone: "violet",
    evidenceStatus: "regional-anchor",
    matcher: /north korea|south korea|korean/i,
  },
  {
    id: "kashmir",
    label: "India–Pakistan border",
    region: "South Asia",
    coordinates: [74.48, 34.18],
    countryCodes: ["IN", "PK"],
    countryFeatureIds: ["IND", "PAK"],
    tone: "blue",
    evidenceStatus: "regional-anchor",
    matcher: /(?=.*india)(?=.*pakistan)|(?=.*pakistan)(?=.*india)/i,
  },
  {
    id: "himalayan-border",
    label: "Himalayan border",
    region: "South Asia",
    coordinates: [79.1, 32.4],
    countryCodes: ["IN", "CN"],
    countryFeatureIds: ["IND", "CHN"],
    tone: "blue",
    evidenceStatus: "regional-anchor",
    matcher: /(?=.*china)(?=.*india)|(?=.*india)(?=.*china)/i,
  },
  {
    id: "east-china-sea",
    label: "East China Sea",
    region: "East Asia",
    coordinates: [126.2, 29.2],
    countryCodes: ["CN", "JP"],
    countryFeatureIds: ["CHN", "JPN"],
    tone: "violet",
    evidenceStatus: "regional-anchor",
    matcher: /(?=.*china)(?=.*japan)|(?=.*japan)(?=.*china)/i,
  },
  {
    id: "greenland",
    label: "Greenland",
    region: "North Atlantic",
    coordinates: [-42.6, 64.18],
    countryCodes: ["GL", "DK"],
    countryFeatureIds: ["GRL", "DNK"],
    tone: "blue",
    evidenceStatus: "country-anchor",
    matcher: /greenland|denmark/i,
  },
  {
    id: "panama-canal",
    label: "Panama Canal",
    region: "Central America",
    coordinates: [-79.68, 9.08],
    countryCodes: ["PA"],
    countryFeatureIds: ["PAN"],
    tone: "orange",
    evidenceStatus: "exact-place",
    matcher: /panama canal/i,
  },
  {
    id: "mexico",
    label: "Mexico",
    region: "North America",
    coordinates: [-102.2, 23.6],
    countryCodes: ["MX"],
    countryFeatureIds: ["MEX"],
    tone: "orange",
    evidenceStatus: "country-anchor",
    matcher: /mexico/i,
  },
  {
    id: "cuba",
    label: "Cuba",
    region: "Caribbean",
    coordinates: [-79.5, 21.7],
    countryCodes: ["CU"],
    countryFeatureIds: ["CUB"],
    tone: "orange",
    evidenceStatus: "country-anchor",
    matcher: /cuba/i,
  },
  {
    id: "venezuela",
    label: "Venezuela",
    region: "South America",
    coordinates: [-66.6, 7.1],
    countryCodes: ["VE"],
    countryFeatureIds: ["VEN"],
    tone: "orange",
    evidenceStatus: "country-anchor",
    matcher: /venezuela/i,
  },
  {
    id: "colombia",
    label: "Colombia",
    region: "South America",
    coordinates: [-74.3, 4.5],
    countryCodes: ["CO"],
    countryFeatureIds: ["COL"],
    tone: "orange",
    evidenceStatus: "country-anchor",
    matcher: /colombia/i,
  },
  {
    id: "sudan",
    label: "Sudan",
    region: "Northeast Africa",
    coordinates: [32.56, 15.5],
    countryCodes: ["SD"],
    countryFeatureIds: ["SDN"],
    tone: "orange",
    evidenceStatus: "country-anchor",
    matcher: /sudan/i,
  },
  {
    id: "aegean-sea",
    label: "Aegean Sea",
    region: "Eastern Mediterranean",
    coordinates: [25.3, 38.5],
    countryCodes: ["GR", "TR"],
    countryFeatureIds: ["GRC", "TUR"],
    tone: "blue",
    evidenceStatus: "regional-anchor",
    matcher: /(?=.*greece)(?=.*turkey)|(?=.*turkey)(?=.*greece)/i,
  },
  {
    id: "eastern-mediterranean",
    label: "Eastern Mediterranean",
    region: "Eastern Mediterranean",
    coordinates: [34.5, 35.2],
    countryCodes: ["IL", "TR"],
    countryFeatureIds: ["ISR", "TUR"],
    tone: "red",
    evidenceStatus: "regional-anchor",
    matcher: /(?=.*israel)(?=.*turkey)|(?=.*turkey)(?=.*israel)/i,
  },
  {
    id: "iran",
    label: "Iran",
    region: "Middle East",
    coordinates: [53.7, 32.4],
    countryCodes: ["IR"],
    countryFeatureIds: ["IRN"],
    tone: "red",
    evidenceStatus: "country-anchor",
    matcher: /(?=.*(?:israel|u\.s\.|\bus\b|european))(?=.*iran)|(?=.*iran)(?=.*(?:israel|u\.s\.|\bus\b|european))/i,
  },
  {
    id: "kuwait",
    label: "Kuwait",
    region: "Persian Gulf",
    coordinates: [47.98, 29.38],
    countryCodes: ["KW"],
    countryFeatureIds: ["KWT"],
    tone: "red",
    evidenceStatus: "country-anchor",
    matcher: /kuwait/i,
  },
  {
    id: "syria",
    label: "Syria",
    region: "Levant",
    coordinates: [38.5, 35.0],
    countryCodes: ["SY"],
    countryFeatureIds: ["SYR"],
    tone: "red",
    evidenceStatus: "country-anchor",
    matcher: /syria|damascus/i,
  },
  {
    id: "yemen",
    label: "Yemen",
    region: "Red Sea",
    coordinates: [44.2, 15.4],
    countryCodes: ["YE"],
    countryFeatureIds: ["YEM"],
    tone: "orange",
    evidenceStatus: "country-anchor",
    matcher: /yemen|houthi/i,
  },
  {
    id: "israel",
    label: "Israel",
    region: "Levant",
    coordinates: [34.82, 31.9],
    countryCodes: ["IL"],
    countryFeatureIds: ["ISR"],
    tone: "red",
    evidenceStatus: "country-anchor",
    matcher: /israel/i,
  },
  {
    id: "iran",
    label: "Iran",
    region: "Middle East",
    coordinates: [53.7, 32.4],
    countryCodes: ["IR"],
    countryFeatureIds: ["IRN"],
    tone: "red",
    evidenceStatus: "country-anchor",
    matcher: /iran/i,
  },
  {
    id: "eastern-ukraine",
    label: "Eastern Ukraine",
    region: "Eastern Europe",
    coordinates: [36.8, 48.55],
    countryCodes: ["UA", "RU"],
    countryFeatureIds: ["UKR", "RUS"],
    tone: "violet",
    evidenceStatus: "regional-anchor",
    matcher: /ukraine|russia capture|russia enter|donbas/i,
  },
  {
    id: "baltic-region",
    label: "NATO eastern flank",
    region: "Eastern Europe",
    coordinates: [24.6, 55.4],
    countryCodes: ["RU", "PL", "LT", "LV", "EE"],
    countryFeatureIds: ["RUS", "POL", "LTU", "LVA", "EST"],
    tone: "blue",
    evidenceStatus: "regional-anchor",
    matcher: /(?=.*(?:russia|russian))(?=.*nato)|(?=.*nato)(?=.*(?:russia|russian))/i,
  },
  {
    id: "novaya-zemlya",
    label: "Novaya Zemlya",
    region: "Russian Arctic",
    coordinates: [56.0, 73.3],
    countryCodes: ["RU"],
    countryFeatureIds: ["RUS"],
    tone: "violet",
    evidenceStatus: "regional-anchor",
    matcher: /russia nuclear test|russian nuclear test/i,
  },
  {
    id: "nevada-test-site",
    label: "Nevada",
    region: "North America",
    coordinates: [-116.05, 37.12],
    countryCodes: ["US"],
    countryFeatureIds: ["USA"],
    tone: "orange",
    evidenceStatus: "regional-anchor",
    matcher: /u\.s\. nuclear test|us nuclear test/i,
  },
];

export function resolveConflictLocation(
  text: string,
): ConflictLocationRule | null {
  const explicitLocation = CONFLICT_LOCATION_RULES.find((rule) =>
    rule.matcher.test(text),
  );
  if (explicitLocation) return explicitLocation;

  const country = resolveCountryAnchor(text);
  if (!country) return null;
  return {
    id: country.id,
    label: country.label,
    region: country.region,
    coordinates: country.coordinates,
    countryCodes: [country.countryCode],
    countryFeatureIds: [country.countryFeatureId],
    tone: country.tone,
    evidenceStatus: "country-anchor",
    matcher: country.matcher,
  };
}

interface ParticipantCountry {
  code: string;
  featureId: string;
  matcher: RegExp;
}

interface AllianceCountry {
  code: string;
  featureId: string;
}

export interface ConflictParticipants {
  countryCodes: string[];
  countryFeatureIds: string[];
  geographyKind: PreviewGeographyKind;
}

const PARTICIPANT_COUNTRIES: readonly ParticipantCountry[] = [
  { code: "US", featureId: "USA", matcher: /\b(?:u\.?s\.?a?\.?|united states|america(?:n)?)\b/i },
  { code: "RU", featureId: "RUS", matcher: /\b(?:russia|russian)\b/i },
  { code: "UA", featureId: "UKR", matcher: /\bukrain(?:e|ian)\b/i },
  { code: "IR", featureId: "IRN", matcher: /\biran(?:ian)?\b/i },
  { code: "IL", featureId: "ISR", matcher: /\bisrael(?:i)?\b/i },
  { code: "CN", featureId: "CHN", matcher: /\bchin(?:a|ese)\b/i },
  { code: "TW", featureId: "TWN", matcher: /\btaiwan(?:ese)?\b/i },
  { code: "IN", featureId: "IND", matcher: /\bindia(?:n)?\b/i },
  { code: "PK", featureId: "PAK", matcher: /\bpakistan(?:i)?\b/i },
  { code: "KP", featureId: "PRK", matcher: /\bnorth korea(?:n)?\b/i },
  { code: "KR", featureId: "KOR", matcher: /\bsouth korea(?:n)?\b/i },
  { code: "SA", featureId: "SAU", matcher: /\bsaudi arabia(?:n)?\b/i },
  { code: "TR", featureId: "TUR", matcher: /\b(?:turkey|turkish|turkiye)\b/i },
  { code: "SY", featureId: "SYR", matcher: /\bsyria(?:n)?\b/i },
  { code: "IQ", featureId: "IRQ", matcher: /\biraq(?:i)?\b/i },
  { code: "YE", featureId: "YEM", matcher: /\byemen(?:i)?\b|\bhouthi\b/i },
  { code: "LB", featureId: "LBN", matcher: /\bleban(?:on|ese)\b|\bhezbollah\b/i },
  { code: "PS", featureId: "PSE", matcher: /\bpalestin(?:e|ian)\b|\bhamas\b/i },
  { code: "GB", featureId: "GBR", matcher: /\b(?:u\.?k\.?|united kingdom|britain|british)\b/i },
  { code: "FR", featureId: "FRA", matcher: /\bfranc(?:e|e's|ais)|\bfrench\b/i },
  { code: "DE", featureId: "DEU", matcher: /\bgerman(?:y)?\b/i },
  { code: "PL", featureId: "POL", matcher: /\bpol(?:and|ish)\b/i },
];

const NATO_COUNTRIES: readonly AllianceCountry[] = [
  ["AL", "ALB"], ["BE", "BEL"], ["BG", "BGR"], ["CA", "CAN"],
  ["HR", "HRV"], ["CZ", "CZE"], ["DK", "DNK"], ["EE", "EST"],
  ["FI", "FIN"], ["FR", "FRA"], ["DE", "DEU"], ["GR", "GRC"],
  ["HU", "HUN"], ["IS", "ISL"], ["IT", "ITA"], ["LV", "LVA"],
  ["LT", "LTU"], ["LU", "LUX"], ["ME", "MNE"], ["NL", "NLD"],
  ["MK", "MKD"], ["NO", "NOR"], ["PL", "POL"], ["PT", "PRT"],
  ["RO", "ROU"], ["SK", "SVK"], ["SI", "SVN"], ["ES", "ESP"],
  ["SE", "SWE"], ["TR", "TUR"], ["GB", "GBR"], ["US", "USA"],
].map(([code, featureId]) => ({ code, featureId }));

const EU_COUNTRIES: readonly AllianceCountry[] = [
  ["AT", "AUT"], ["BE", "BEL"], ["BG", "BGR"], ["HR", "HRV"],
  ["CY", "CYP"], ["CZ", "CZE"], ["DK", "DNK"], ["EE", "EST"],
  ["FI", "FIN"], ["FR", "FRA"], ["DE", "DEU"], ["GR", "GRC"],
  ["HU", "HUN"], ["IE", "IRL"], ["IT", "ITA"], ["LV", "LVA"],
  ["LT", "LTU"], ["LU", "LUX"], ["MT", "MLT"], ["NL", "NLD"],
  ["PL", "POL"], ["PT", "PRT"], ["RO", "ROU"], ["SK", "SVK"],
  ["SI", "SVN"], ["ES", "ESP"], ["SE", "SWE"],
].map(([code, featureId]) => ({ code, featureId }));

const NATO_PATTERN = /\bNATO\b/i;
const EU_PATTERN = /\bEU\b|\bEuropean Union\b/i;

export function resolveConflictParticipants(
  text: string,
  location: ConflictLocationRule,
): ConflictParticipants {
  const byFeatureId = new Map<string, string>();
  location.countryFeatureIds.forEach((featureId, index) => {
    const code = location.countryCodes[index];
    if (code) byFeatureId.set(featureId, code);
  });

  for (const country of PARTICIPANT_COUNTRIES) {
    if (country.matcher.test(text)) byFeatureId.set(country.featureId, country.code);
  }
  for (const country of resolveCountryParticipants(text)) {
    byFeatureId.set(country.countryFeatureId, country.countryCode);
  }

  const hasNato = NATO_PATTERN.test(text);
  const hasEu = EU_PATTERN.test(text);
  if (hasNato) {
    for (const country of NATO_COUNTRIES) {
      byFeatureId.set(country.featureId, country.code);
    }
  }
  if (hasEu) {
    for (const country of EU_COUNTRIES) {
      byFeatureId.set(country.featureId, country.code);
    }
  }

  const geographyKind: PreviewGeographyKind =
    hasNato || hasEu
      ? "alliance"
      : location.evidenceStatus === "exact-place"
        ? "place"
        : location.evidenceStatus === "country-anchor" && byFeatureId.size === 1
          ? "country"
          : "regional";

  return {
    countryCodes: [...byFeatureId.values()],
    countryFeatureIds: [...byFeatureId.keys()],
    geographyKind,
  };
}
