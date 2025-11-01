# 🧩 Linked Summary

**Summaries you can verify — each linked back to its source.**

---

## 🚀 Inspiration

AI summaries are everywhere, but they often lose context and trust.  
We wondered — if RAG can improve trust by citing external sources, why shouldn’t we do the same for internal ones?  
**Linked Summary** was born from that question: making on-page summaries verifiable by linking them back to their origins.

---

## 💡 What it does

Linked Summary is a Chrome extension that uses **Chrome’s built-in AI** to summarize any webpage or article.  
Unlike other summarizers, its key feature is that it **connects every sentence of the summary directly to its original source** in the text.

This allows users to:

- Generate concise summaries directly in the browser
- Click any summary sentence to instantly scroll to its corresponding paragraph or sentence
- Verify the accuracy and context of AI-generated summary in one click
- Keep all data **local**, ensuring privacy and speed — no cloud calls, no tracking

---

## 🛠 How we built it

We used the **Chrome built-in AI API** for on-device summarization, then applied **transformer-based semantic embeddings** (`@xenova/transformers`) to find semantically close relationships between summaries, paragraphs, and sentences.  
The frontend, built with **`lit`**, provides an efficient, lightweight interface for exploring summaries and sources side by side.

---

## ⚙️ Challenges we ran into

The main challenge was finding **semantically closest relationships** between summaries, paragraphs, and sentences.  
We needed to capture meaning beyond surface-level similarity, linking each AI-generated phrase to its true origin within complex, dynamic HTML.  
Optimizing this semantic matching for both **accuracy and speed** — while running entirely in-browser — became the core technical challenge of the project.

---

## 🏆 Accomplishments we’re proud of

- Built a **fully local summarization pipeline** with Chrome’s built-in AI — no external API calls
- Designed a **semantic anchoring algorithm** that connects summaries to exact DOM segments
- Delivered a **fast, transparent, and privacy-first UX** that makes AI output verifiable

---

## 📚 What we learned

- How to integrate **on-device AI** for real-world use inside Chrome extensions
- Building **robust semantic alignment systems** that survive dynamic DOM updates
- The importance of **explainability and user trust** in every AI interaction

---

## 🔮 What's next for Linked Summary

- Extend coverage to **dynamic and script-heavy webpages**
- Add **interactive highlight effects** and smoother navigation
