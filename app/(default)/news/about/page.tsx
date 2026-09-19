import { AboutNewsView } from "@/components/news/about";
import { newsUtilityMetadata } from "@/lib/news/metadata";
export const metadata=newsUtilityMetadata("about");
export default function AboutNews(){return <AboutNewsView/>;}
