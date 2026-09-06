import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { PbfWriter } from "pbf";

const locales=["zh","ko","vi","de","es","pt-BR","fr","ru","uk","fa","he"];
const countries=JSON.parse(await readFile("public/maps/ne_110m_admin_0_countries.geojson","utf8"));
const labels=JSON.parse(await readFile("public/maps/ne_110m_admin_0_country_labels.geojson","utf8"));
const codes=new Map(countries.features.map(feature=>[feature.properties.NAME,feature.properties.ISO_A2_EH]));
await mkdir("public/maps/localized-v1",{recursive:true});
for(const locale of locales){
  const names=new Intl.DisplayNames([locale],{type:"region"});
  const localized={...labels,features:labels.features.map(feature=>{
    const code=codes.get(feature.properties.NAME);const name=code&&/^[A-Z]{2}$/.test(code)?names.of(code):feature.properties.NAME;
    return {...feature,properties:{...feature.properties,NAME:name,NAME_LONG:name}};
  })};
  await writeFile(`public/maps/localized-v1/countries-${locale}.geojson`,JSON.stringify(localized));
}
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();
  const [latin,cjk,sdf]=await Promise.all([
    readFile("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    readFile(".local/fonts/NotoSansCJKsc-Regular.otf"),
    readFile("node_modules/@mapbox/tiny-sdf/index.js","utf8"),
  ]);
  await page.setContent(`<style>@font-face{font-family:MapUnicode;src:url(data:font/ttf;base64,${latin.toString("base64")})}@font-face{font-family:MapCJK;src:url(data:font/otf;base64,${cjk.toString("base64")})}</style>`);
  await page.addScriptTag({content:sdf.replace("export default class TinySDF","class TinySDF")+"\nglobalThis.FontSdf=TinySDF;"});
  await page.evaluate(async()=>{await Promise.all([document.fonts.load('24px MapUnicode'),document.fonts.load('24px MapCJK')]);});
  const starts=[...new Set([...Array.from({length:48},(_,i)=>i*256),...Array.from({length:169},(_,i)=>0x3000+i*256),0xfb00,0xfc00,0xfd00,0xfe00,0xff00])];
  const directory="public/maps/fonts/unicode-v1";await mkdir(directory,{recursive:true});
  let total=0;
  for(const start of starts){
    if(process.argv.includes("--missing")&&existsSync(`${directory}/${start}-${start+255}.pbf.gz`))continue;
    const range=await page.evaluate(start=>{
      const sdf=new globalThis.FontSdf({fontSize:24,fontFamily:'MapUnicode, MapCJK',fontWeight:'400',buffer:3,radius:8,cutoff:.25});
      return {range:`${start}-${start+255}`,glyphs:Array.from({length:256},(_,offset)=>{
        const id=start+offset,char=sdf.draw(String.fromCodePoint(id));
        return {id,bitmap:Array.from(char.data),width:char.glyphWidth,height:char.glyphHeight,left:Math.round(char.glyphLeft+.5),top:Math.round(char.glyphTop-27.5),advance:Math.round(char.glyphAdvance)};
      })};
    },start);
    const writer=new PbfWriter();writer.writeMessage(1,(stack,pbf)=>{
      pbf.writeStringField(1,"OddsFront Unicode");pbf.writeStringField(2,stack.range);
      for(const glyph of stack.glyphs)pbf.writeMessage(3,(glyph,pbf)=>{
        pbf.writeVarintField(1,glyph.id);pbf.writeBytesField(2,Uint8Array.from(glyph.bitmap));pbf.writeVarintField(3,glyph.width);pbf.writeVarintField(4,glyph.height);pbf.writeSVarintField(5,glyph.left);pbf.writeSVarintField(6,glyph.top);pbf.writeVarintField(7,glyph.advance);
      },glyph);
    },range);
    const data=gzipSync(writer.finish(),{level:9});total+=data.length;await writeFile(`${directory}/${range.range}.pbf.gz`,data);
  }
  console.log(JSON.stringify({locales:locales.length,glyphRanges:starts.length,compressedBytes:total}));
}finally{await browser.close();}
