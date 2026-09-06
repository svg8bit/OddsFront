"use client";
import { NewsChrome } from "./news";
import { useLocale } from "@/components/locale-provider";
import blocks from "@/lib/news/about.json";
import styles from "./news.module.css";
export function AboutNewsView(){const {translate}=useLocale();return <NewsChrome><article className={styles.prose}>{blocks.map((block,index)=>{const Tag=block.tag as "h1"|"h2"|"p";return <Tag key={index}>{translate(block.text)}</Tag>;})}</article></NewsChrome>;}
