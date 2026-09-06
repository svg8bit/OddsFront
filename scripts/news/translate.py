"""Translate published OddsFront text locally; no paid APIs or browser work."""
import subprocess
import sys
import unicodedata
from collections import Counter
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.request import Request, urlopen

import ctranslate2
import sentencepiece

DIRECTORY = Path(os.environ.get("ODDSFRONT_NEWS_DIRECTORY", "/root/OddsFront/.local/news"))
MODEL = Path("/root/OddsFront/.local/translation-model")
LANGUAGES = ["zh", "ko", "vi", "de", "es", "pt-BR", "fr", "ru", "uk", "fa", "he"]


def atomic_json(path, data, public=False):
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    temporary.chmod(0o644 if public else 0o600)
    temporary.replace(path)


def summary(article):
    return {**article, "readingMinutes": max(1, (len(" ".join(block["text"] for block in article["body"]).split()) + 219) // 220), "body": [], "translations": {
        language: {**text, "body": []} for language, text in article["translations"].items()
    }}


def export_catalog(catalog):
    public = Path(os.environ.get("ODDSFRONT_NEWS_PUBLIC_DIRECTORY", str(DIRECTORY / "public") if os.environ.get("ODDSFRONT_NEWS_DIRECTORY") else "/opt/oddsfront-market-feed/news"))
    articles = public / "articles"
    articles.mkdir(parents=True, exist_ok=True)
    public.chmod(0o755)
    articles.chmod(0o755)
    for article in catalog["articles"]:
        atomic_json(articles / f'{article["slug"]}.json', article, public=True)
    atomic_json(public / "catalog.json", {**catalog, "articles": [summary(article) for article in catalog["articles"]]}, public=True)


def main():
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    if not os.environ.get("ODDSFRONT_EDITION_LOCKED"):
        result = subprocess.run(["flock", "-n", str(DIRECTORY / "edition.lock"), sys.executable, __file__], env={**os.environ, "ODDSFRONT_EDITION_LOCKED": "1"})
        raise SystemExit(result.returncode)
    if True:
        catalog_path = DIRECTORY / "catalog.json"
        catalog = json.loads(catalog_path.read_text())
        cache_path = DIRECTORY / "translation-cache.json"
        cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
        tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(MODEL / "source/sentencepiece.bpe.model"))
        translator = ctranslate2.Translator(str(MODEL / "int8"), device="cpu", compute_type="int8", intra_threads=2)
        texts = set()
        for article in catalog["articles"]:
            texts.update([article["title"], article["description"], *article["topics"], *[block["text"] for block in article["body"]]])
        market_texts = set()
        market_feed_available = False
        try:
            with urlopen(Request("https://oddsfront.com/api/global-conflict-events", headers={"User-Agent": "OddsFrontLocalTranslator/1.0"}), timeout=15) as response:
                feed = json.load(response)
            for event in feed.get("events", []):
                market_texts.update([event["title"], event["locationLabel"], event["region"]])
            texts.update(market_texts)
            market_feed_available = True
        except Exception as error:
            print(f"Market translation refresh unavailable: {type(error).__name__}", flush=True)
        # Public explanatory pages share the same offline translation cache.
        extra_path = Path(__file__).with_name("translation-extra.json")
        if extra_path.exists():
            texts.update(json.loads(extra_path.read_text()))
        def key(language, text):
            return hashlib.sha256(f"m2m100-v1:{language}:{text}".encode()).hexdigest()
        for language in LANGUAGES:
            target = "pt" if language == "pt-BR" else language
            pending = [text for text in sorted(texts) if key(language, text) not in cache]
            # Split at sentence boundaries before tokenization; never truncate a paragraph.
            pieces = []
            owners = []
            for text in pending:
                sentences = re.split(r"(?<=[.!?])\s+", text)
                for sentence in sentences:
                    words = sentence.split()
                    for offset in range(0, len(words), 65):
                        piece = " ".join(words[offset:offset + 65])
                        if piece:
                            tokens = ["__en__", *tokenizer.encode(piece, out_type=str), "</s>"]
                            if len(tokens) > 510:
                                raise ValueError("Translation segment exceeds token budget; original retained")
                            pieces.append(tokens)
                            owners.append(text)
            translated = {text: [] for text in pending}
            for start in range(0, len(pieces), 16):
                batch = pieces[start:start+16]
                results = translator.translate_batch(batch, target_prefix=[[f"__{target}__"] for _ in batch], beam_size=2, max_batch_size=512, batch_type="tokens", max_decoding_length=320, max_input_length=512, no_repeat_ngram_size=4)
                for index, result in enumerate(results):
                    tokens = [token for token in result.hypotheses[0] if not token.startswith("__") and token not in ["</s>", "<s>"]]
                    value = tokenizer.decode(tokens).strip()
                    if not value:
                        raise ValueError(f"Empty translation for {language}")
                    translated[owners[start + index]].append(value)
            for text, values in translated.items():
                cache[key(language, text)] = " ".join(values)
            def translated_text(text):
                value = cache.get(key(language, text), text)
                # Preserve source numbers even when the model changes numeral scripts.
                def numbers(value):
                    normalized = "".join(str(unicodedata.digit(char)) if char.isdigit() else char for char in value)
                    return Counter(re.findall(r"\d+", normalized))
                return text if numbers(text) - numbers(value) else value
            for article in catalog["articles"]:
                article["translations"][language] = {
                    "title": translated_text(article["title"]),
                    "description": translated_text(article["description"]),
                    "body": [{**block, "text": translated_text(block["text"])} for block in article["body"]],
                }
            dictionary = {} if market_feed_available else catalog.get("marketTranslations", {}).get(language, {}).copy()
            dictionary.update({text: translated_text(text) for text in market_texts | {topic for article in catalog["articles"] for topic in article["topics"]} | (set(json.loads(extra_path.read_text())) if extra_path.exists() else set())})
            catalog.setdefault("marketTranslations", {})[language] = dictionary
            atomic_json(cache_path, cache)
            atomic_json(catalog_path, catalog)
            export_catalog(catalog)
            print(json.dumps({"language": language, "newTexts": len(pending), "articles": len(catalog["articles"]), "marketTexts": len(market_texts)}), flush=True)


if __name__ == "__main__":
    main()
