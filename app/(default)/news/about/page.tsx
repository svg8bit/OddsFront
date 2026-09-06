import type { Metadata } from "next";
import { AboutNewsView } from "@/components/news/about";
export const metadata:Metadata={title:"About the newsdesk | OddsFront",alternates:{canonical:"/news/about"}};
export default function AboutNews(){return <AboutNewsView/>;}
