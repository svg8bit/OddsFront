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
from datetime import datetime, timezone
from urllib.request import Request, urlopen

import ctranslate2
import sentencepiece

DIRECTORY = Path(os.environ.get("ODDSFRONT_NEWS_DIRECTORY", "/root/OddsFront/.local/news"))
MODEL = Path("/root/OddsFront/.local/translation-model")
LANGUAGES = ["ru", "zh", "ko", "vi", "de", "es", "pt-BR", "fr", "uk", "fa", "he"]
TRANSLATION_TEXT_BUDGET = max(50, min(500, int(os.environ.get("ODDSFRONT_TRANSLATION_TEXT_BUDGET", "150"))))


def article_source_texts(article):
    return {
        article["title"],
        article["description"],
        *article["topics"],
        *(block["text"] for block in article["body"]),
    }


def select_pending_texts(active_articles, dictionary_texts, language, cache, cache_key, budget):
    article_pending = set()
    ordered_articles = sorted(active_articles, key=lambda article: article["publishedAt"], reverse=True)
    for article in ordered_articles:
        missing = {text for text in article_source_texts(article) if cache_key(language, text) not in cache}
        if not missing:
            continue
        if article_pending and len(article_pending | missing) > budget:
            break
        article_pending.update(missing)
        if len(article_pending) >= budget:
            break
    remaining = max(0, budget - len(article_pending))
    dictionary_pending = [
        text for text in sorted(dictionary_texts - article_pending)
        if cache_key(language, text) not in cache
    ][:remaining]
    return sorted(article_pending) + dictionary_pending


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
        if not article.get("withdrawal"):
            atomic_json(articles / f'{article["slug"]}.json', article, public=True)
    atomic_json(public / "catalog.json", {**catalog, "articles": [summary(article) for article in catalog["articles"] if not article.get("withdrawal")]}, public=True)
    for article in catalog["articles"]:
        if article.get("withdrawal"):
            if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", article["slug"]):
                raise ValueError("Invalid withdrawn article slug")
            (articles / f'{article["slug"]}.json').unlink(missing_ok=True)


def main():
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    if not os.environ.get("ODDSFRONT_EDITION_LOCKED"):
        result = subprocess.run(["flock", "-n", "-E", "75", str(DIRECTORY / "edition.lock"), sys.executable, __file__], env={**os.environ, "ODDSFRONT_EDITION_LOCKED": "1"})
        raise SystemExit(result.returncode)
    if True:
        catalog_path = DIRECTORY / "catalog.json"
        catalog = json.loads(catalog_path.read_text())
        active_articles = [article for article in catalog["articles"] if not article.get("withdrawal")]
        cache_path = DIRECTORY / "translation-cache.json"
        cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
        tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(MODEL / "source/sentencepiece.bpe.model"))
        translator = ctranslate2.Translator(str(MODEL / "int8"), device="cpu", compute_type="int8", intra_threads=2)
        texts = set()
        for article in active_articles:
            texts.update(article_source_texts(article))
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
        extra_texts = set()
        if extra_path.exists():
            extra_texts.update(json.loads(extra_path.read_text()))
            texts.update(extra_texts)
        def key(language, text):
            return hashlib.sha256(f"m2m100-v1:{language}:{text}".encode()).hexdigest()
        configured_languages = os.environ.get("ODDSFRONT_TRANSLATION_LANGUAGES")
        languages = configured_languages.split(",") if configured_languages else list(LANGUAGES)
        if not languages or any(language not in LANGUAGES for language in languages):
            raise ValueError("Unsupported translation language")
        if not configured_languages:
            # Russian is reviewed before the RU social follow-up. Rotate the
            # remaining offline work by actual coverage deficit so a bounded
            # service run cannot starve languages near the end of a fixed list.
            def backlog(language):
                missing_articles = sum(1 for article in active_articles if language not in article["translations"])
                missing_texts = sum(1 for text in texts if key(language, text) not in cache)
                return (missing_articles, missing_texts, -LANGUAGES.index(language))
            languages = ["ru", *sorted((language for language in LANGUAGES if language != "ru"), key=backlog, reverse=True)]
            print(json.dumps({"translationOrder": languages}), flush=True)
        for language in languages:
            reviewed = {}
            if language == "ru":
                # Headlines, descriptions and candidate market questions receive
                # a source-faithful editorial translation before RU publication.
                # Other article paragraphs retain the labelled offline model.
                subprocess.run(["node", str(Path(__file__).with_name("review-russian.ts"))], check=True, timeout=210)
                reviewed = json.loads((DIRECTORY / "russian-editor-cache.json").read_text())
                cache.update(reviewed)
            target = "pt" if language == "pt-BR" else language
            # Finish the newest articles in every language before spending the
            # bounded service window on older archive or map-dictionary work.
            # A complete article becomes public; a partial translation remains
            # only in the private cache until all of its fields are ready.
            dictionary_texts = market_texts | {
                topic for article in active_articles for topic in article["topics"]
            } | extra_texts
            pending = select_pending_texts(
                active_articles,
                dictionary_texts,
                language,
                cache,
                key,
                TRANSLATION_TEXT_BUDGET,
            )
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
            expected_pieces = Counter(owners)
            for start in range(0, len(pieces), 16):
                batch = pieces[start:start+16]
                results = translator.translate_batch(batch, target_prefix=[[f"__{target}__"] for _ in batch], beam_size=2, max_batch_size=512, batch_type="tokens", max_decoding_length=320, max_input_length=512, no_repeat_ngram_size=4)
                for index, result in enumerate(results):
                    tokens = [token for token in result.hypotheses[0] if not token.startswith("__") and token not in ["</s>", "<s>"]]
                    value = tokenizer.decode(tokens).strip()
                    if not value:
                        raise ValueError(f"Empty translation for {language}")
                    translated[owners[start + index]].append(value)
                    owner = owners[start + index]
                    if len(translated[owner]) == expected_pieces[owner]:
                        cache[key(language, owner)] = " ".join(translated[owner])
                # Keep completed texts across a bounded worker timeout. A
                # partially translated paragraph never enters the cache.
                atomic_json(cache_path, cache)
            for text, values in translated.items():
                cache[key(language, text)] = " ".join(values)
            def translated_text(text):
                value = cache.get(key(language, text), text)
                # Preserve source numbers even when the model changes numeral scripts.
                def numbers(value):
                    normalized = "".join(str(unicodedata.digit(char)) if char.isdigit() else char for char in value)
                    return Counter(re.findall(r"\d+", normalized))
                return text if numbers(text) - numbers(value) else value
            for article in active_articles:
                if not all(key(language, text) in cache for text in article_source_texts(article)):
                    continue
                previous = article["translations"].get(language)
                article["translations"][language] = {
                    "title": translated_text(article["title"]),
                    "description": translated_text(article["description"]),
                    "body": [{**block, "text": translated_text(block["text"])} for block in article["body"]],
                    **({"editorReviewed": True} if key(language, article["title"]) in reviewed and key(language, article["description"]) in reviewed else {}),
                }
                if article["translations"][language].get("editorReviewed") and article["translations"][language] != previous:
                    # Version the social image URL when reviewed Russian copy
                    # replaces an earlier machine headline in a cached preview.
                    article["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                    catalog["updatedAt"] = article["updatedAt"]
            dictionary = {} if market_feed_available else catalog.get("marketTranslations", {}).get(language, {}).copy()
            dictionary.update({text: translated_text(text) for text in dictionary_texts if key(language, text) in cache})
            catalog.setdefault("marketTranslations", {})[language] = dictionary
            atomic_json(cache_path, cache)
            atomic_json(catalog_path, catalog)
            export_catalog(catalog)
            remaining_texts = sum(1 for text in texts if key(language, text) not in cache)
            print(json.dumps({"language": language, "newTexts": len(pending), "remainingTexts": remaining_texts, "articles": len(catalog["articles"]), "marketTexts": len(market_texts)}), flush=True)


if __name__ == "__main__":
    main()
